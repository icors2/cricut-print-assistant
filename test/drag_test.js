// Interactive layout canvas + sidebar UI, end to end in headless Chrome:
// real mouse drags / keys / buttons, then an independent parse of the exported PDF and SVG to prove hand-placed
// positions come out exactly (plain and with calibration ON), plus selection sync, collapse, aspect lock, filter,
// fill, undo/redo, status chips and project round trip. Saves UI screenshots to sample_output/.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const PT = 72;

// ---- independent parsers ----
function pdfPlacements(buf) { // [[{x,y,w,h} in pt, PDF y-up]] per content stream that draws images
  const s = buf.toString('latin1'), out = []; const re = /<<([\s\S]*?)>>\s*stream\r?\n/g; let m;
  while ((m = re.exec(s))) { const st = m.index + m[0].length, len = +(/\/Length (\d+)/.exec(m[1]) || [])[1]; if (!len || /\/Subtype\s*\/Image/.test(m[1])) continue;
    let data = Buffer.from(s.slice(st, st + len), 'latin1'); if (/FlateDecode/.test(m[1])) { try { data = zlib.inflateSync(data); } catch (e) { continue; } }
    const t = data.toString('latin1'), pl = []; const r2 = /([\d.\-]+) 0 0 ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) cm\s*\/(\S+) Do/g; let k;
    while ((k = r2.exec(t))) pl.push({ w: +k[1], h: +k[2], x: +k[3], y: +k[4] }); if (pl.length) out.push(pl); }
  return out; }
function svgSubpathBoxes(svg) { // bbox (pt, canvas coords) of each subpath's points in the "cuts" path
  const d = /id="cuts"[^>]*d="([^"]+)"/.exec(svg)[1]; return d.split(/(?=M)/).filter(x => x.trim()).map(sp => { const n = (sp.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i + 1 < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); } return [x0, y0, x1, y1]; }); }
const key4 = (b) => b.map(v => v.toFixed(1)).join(',');

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-features=WebShare', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1000 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload();
  const S = path.join(__dirname, 'samples');
  await (await p.$('#file')).uploadFile(...['star_sticker.png', 'label_square.jpg', 'heart.svg', 'gradient_photo.jpg', 'donut_badge.png', 'two_blobs.png'].map(f => path.join(S, f)));
  await p.waitForFunction(() => window.CST.items.length === 6, { timeout: 20000 });
  await p.evaluate(() => { const C = window.CST, q = { 'star_sticker.png': 3, 'label_square.jpg': 2, 'heart.svg': 2 }; C.items.forEach(i => { i.qty = q[i.name] || 1; if (i.name === 'gradient_photo.jpg') C.setPct(i, 40); }); C.refresh(true); });
  await wait(1500);

  // page helpers
  await p.evaluate(() => {
    const C = window.CST;
    window.T = {
      ent: (key) => { for (const [si, s] of C.layout.sheets.entries()) for (const e of s) if (e.key === key) return { si, x: e.x, y: e.y, w: e.p.cutW, h: e.p.cutH, rot: e.rot, key: e.key, name: e.it.name }; return null; },
      B: () => { const L = C.layout; return { x0: L.m.l, y0: L.m.t, x1: L.m.l + L.uw, y1: L.m.t + L.uh }; },
      screen: (x, y) => { const c = document.querySelector('#preview'), r = c.getBoundingClientRect(), k = r.width / c.width * C.view.sc; return { x: r.left + x * k, y: r.top + y * k }; },
      check: () => { const L = C.layout, sp = C.S.spacing, B = window.T.B(), bad = []; L.sheets.forEach((s, si) => s.forEach((a, i) => {
          if (a.x < B.x0 - 1e-6 || a.y < B.y0 - 1e-6 || a.x + a.p.cutW > B.x1 + 1e-6 || a.y + a.p.cutH > B.y1 + 1e-6) bad.push(`out ${a.key}`);
          s.slice(i + 1).forEach(o => { const t = 1e-6; if (a.x < o.x + o.p.cutW + sp - t && o.x < a.x + a.p.cutW + sp - t && a.y < o.y + o.p.cutH + sp - t && o.y < a.y + a.p.cutH + sp - t) bad.push(`overlap ${a.key}/${o.key} s${si}`); }); })); return bad; },
      free: (key, minDist) => { // a free top-left spot for piece `key` on its sheet, at least minDist away
        const e = window.T.ent(key), L = C.layout, list = L.sheets[e.si], B = window.T.B(), sp = C.S.spacing;
        for (let y = B.y1 - e.h; y >= B.y0; y -= 0.25) for (let x = B.x0; x <= B.x1 - e.w; x += 0.25) { const r = { x, y, w: e.w, h: e.h };
          if (Math.hypot(x - e.x, y - e.y) < minDist) continue;
          if (list.every(o => o.key === key || !(r.x < o.x + o.p.cutW + sp && o.x < r.x + r.w + sp && r.y < o.y + o.p.cutH + sp && o.y < r.y + r.h + sp))) return { x, y }; } return null; } };
  });
  const ent = (k) => p.evaluate((k) => window.T.ent(k), k), check = () => p.evaluate(() => window.T.check());
  const keys = await p.evaluate(() => window.CST.layout.sheets.flat().map(e => e.key));
  const starKey = await p.evaluate(() => window.CST.layout.sheets.flat().find(e => e.it.name === 'star_sticker.png').key);
  async function dragTo(key, x, y) { // drag piece `key` so its top-left lands at (x, y) sheet inches
    const e = await ent(key), grab = { x: e.x + e.w * 0.5, y: e.y + e.h * 0.5 };
    const a = await p.evaluate((x, y) => window.T.screen(x, y), grab.x, grab.y), z = await p.evaluate((x, y) => window.T.screen(x, y), x + e.w * 0.5, y + e.h * 0.5);
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 14 }); await p.mouse.up(); await wait(400); }
  ok(!(await p.evaluate(() => window.CST.layout.manual)), 'starts auto-packed');

  // 1) plain drag to a free spot
  const tgt = await p.evaluate((k) => window.T.free(k, 2), starKey);
  await dragTo(starKey, tgt.x, tgt.y); let e = await ent(starKey);
  ok(await p.evaluate(() => window.CST.layout.manual) && Math.abs(e.x - tgt.x) < 0.11 && Math.abs(e.y - tgt.y) < 0.11, `drag moves the piece by mouse: target ${tgt.x.toFixed(3)},${tgt.y.toFixed(3)} → ${e.x.toFixed(3)},${e.y.toFixed(3)} (snap ≤ 7 px)`);
  ok(await p.evaluate((k) => window.CST.sel.key === k && document.querySelector('.item.sel .iname').textContent === 'star_sticker.png', starKey), 'clicked piece is selected and its card is highlighted');
  ok(!(await check()).length, 'no overlap / out of bounds after drag ' + JSON.stringify(await check()));

  // 2) drop onto another piece: blocked (nudged to nearest legal spot or moved back), never overlapping
  const other = await p.evaluate((k) => window.CST.layout.sheets[window.T.ent(k).si].find(e => e.key !== k).key, starKey);
  const o = await ent(other); const before = await ent(starKey);
  await dragTo(starKey, o.x + 0.1, o.y + 0.1); e = await ent(starKey);
  const toastTxt = await p.$eval('#toast', t => t.textContent);
  ok(!(await check()).length && (/nudged|moved back/.test(toastTxt)), `drop on top of ${other}: refused (“${toastTxt}”), ${before.x.toFixed(2)},${before.y.toFixed(2)} → ${e.x.toFixed(2)},${e.y.toFixed(2)}, no overlaps`);

  // 3) drag far outside the sheet: clamped to the usable area (inside the anchors)
  const B = await p.evaluate(() => window.T.B());
  await dragTo(starKey, 30, 40); e = await ent(starKey);
  const clampOk = (Math.abs(e.x + e.w - B.x1) < 1e-6 || Math.abs(e.y + e.h - B.y1) < 1e-6) && !(await check()).length;
  ok(clampOk, `dragging past the corner clamps to the usable area: right ${(e.x + e.w).toFixed(4)} / ${B.x1.toFixed(4)}, bottom ${(e.y + e.h).toFixed(4)} / ${B.y1.toFixed(4)}`);

  // 5) keyboard nudge (1/16 in, Shift = 1/4 in), R rotate, Esc
  await p.evaluate((k) => { const t = window.T.free(k, 1.5); window.CST.manual.pieces[k].x = t.x; window.CST.manual.pieces[k].y = t.y; window.CST.refresh(false); }, starKey); await wait(300);
  let a0 = await ent(starKey); await p.focus('#preview'); await p.keyboard.press('ArrowRight'); await wait(300); e = await ent(starKey);
  const n1 = Math.abs(e.x - a0.x - 1 / 16) < 1e-9;
  a0 = e; await p.keyboard.down('Shift'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Shift'); await wait(300); e = await ent(starKey);
  ok(n1 && (Math.abs(a0.y - e.y - 0.25) < 1e-9 || /Blocked|edge/.test(await p.$eval('#toast', t => t.textContent))), `arrow nudge: +1/16 in right, Shift+Up −1/4 in (${a0.y.toFixed(4)} → ${e.y.toFixed(4)})`);
  a0 = e; await p.keyboard.press('r'); await wait(400); e = await ent(starKey);
  ok(e.rot !== a0.rot && Math.abs(e.w - a0.h) < 1e-9 && Math.abs(e.h - a0.w) < 1e-9 && !(await check()).length, `R rotates 90° (${a0.w.toFixed(3)}×${a0.h.toFixed(3)} → ${e.w.toFixed(3)}×${e.h.toFixed(3)})`);

  // 6) move to the next sheet (creates sheet 2), then drag there
  await p.click('#selNext'); await wait(500); e = await ent(starKey);
  ok(e.si === 1 && await p.evaluate(() => window.CST.layout.sheets.length === 2 && window.CST.curSheet === 1), 'Next sheet ▶ moves the piece to a new sheet 2 and shows it');
  await dragTo(starKey, B.x0 + 1, B.y0 + 1.5); e = await ent(starKey);
  ok(e.si === 1 && Math.abs(e.x - (B.x0 + 1)) < 0.11, 'drag works on sheet 2');
  // a second copy to sheet 2 so it has 2 pieces
  const star2 = await p.evaluate(() => window.CST.layout.sheets[0].find(e => e.it.name === 'star_sticker.png').key);
  await p.evaluate((k) => window.CST.selectPiece(window.CST.layout.sheets[0].find(e => e.key === k)), star2); await p.evaluate(() => window.CST.curSheet = 0);
  await p.evaluate((k) => window.CST.moveToSheet(window.CST.layout.sheets[0].find(e => e.key === k), 1), star2); await wait(500);
  ok((await ent(star2)).si === 1 && !(await check()).length, 'second piece moved to sheet 2 next to the first, no overlap');

  // 4) snap to spacing: drop 0.03 in further than the spacing from a neighbour → gap snaps to exactly the spacing
  const snapCase = await p.evaluate((k) => { const C = window.CST, L = C.layout, me = window.T.ent(k), sp = C.S.spacing, B = window.T.B();
    for (const o of L.sheets[me.si]) { if (o.key === k) continue; const x = o.x + o.p.cutW + sp + 0.03, y = o.y; const r = { x, y, w: me.w, h: me.h };
      if (r.x + r.w > B.x1 || r.y + r.h > B.y1) continue;
      if (L.sheets[me.si].every(q => q.key === k || !(r.x < q.x + q.p.cutW + sp + 0.12 && q.x < r.x + r.w + sp + 0.12 && r.y < q.y + q.p.cutH + sp + 0.12 && q.y < r.y + r.h + sp + 0.12) || q.key === o.key)) return { nb: o.key, x, y, edge: o.x + o.p.cutW }; } return null; }, star2);
  if (snapCase) { await dragTo(star2, snapCase.x, snapCase.y); e = await ent(star2); const sp = await p.evaluate(() => window.CST.S.spacing);
    ok(Math.abs(e.x - snapCase.edge - sp) < 1e-9, `snap: gap to ${snapCase.nb} is exactly the spacing (${(e.x - snapCase.edge).toFixed(6)} in vs ${sp})`); }
  else ok(false, 'snap: no free neighbour slot found to test');

  await p.evaluate((k) => window.CST.selectPiece(window.CST.layout.sheets[1].find(e => e.key === k)), starKey);
  // 7) duplicate / delete / undo / redo
  const q0 = await p.evaluate(() => window.CST.items.find(i => i.name === 'star_sticker.png').qty);
  await p.focus('#preview'); await p.keyboard.press('d'); await wait(500);
  const q1 = await p.evaluate(() => window.CST.items.find(i => i.name === 'star_sticker.png').qty);
  await p.keyboard.press('Delete'); await wait(500); const q2 = await p.evaluate(() => window.CST.items.find(i => i.name === 'star_sticker.png').qty);
  ok(q1 === q0 + 1 && q2 === q0 && !(await check()).length, `D duplicates (qty ${q0} → ${q1}), Delete removes (→ ${q2})`);
  const posBeforeUndo = await p.evaluate(() => JSON.stringify(window.CST.manual));
  await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await wait(500);
  const q3 = await p.evaluate(() => window.CST.items.find(i => i.name === 'star_sticker.png').qty);
  await p.keyboard.down('Control'); await p.keyboard.press('y'); await p.keyboard.up('Control'); await wait(500);
  const q4 = await p.evaluate(() => window.CST.items.find(i => i.name === 'star_sticker.png').qty);
  ok(q3 === q0 + 1 && q4 === q0 && posBeforeUndo === await p.evaluate(() => JSON.stringify(window.CST.manual)), `Ctrl+Z undoes the delete (qty ${q3}), Ctrl+Y redoes it (qty ${q4}) with identical positions`);
  const fin = await p.evaluate(() => JSON.stringify(window.CST.manual)), seen = new Set([fin]);
  for (let i = 0; i < 4; i++) { await p.click('#undoBtn'); await wait(250); seen.add(await p.evaluate(() => JSON.stringify(window.CST.manual))); }
  for (let i = 0; i < 4; i++) { await p.click('#redoBtn'); await wait(250); }
  ok(seen.size >= 3 && fin === await p.evaluate(() => JSON.stringify(window.CST.manual)), `Undo/Redo buttons step back through ${seen.size - 1} distinct earlier layouts and forward again to the identical one`);

  // 8) collapse all, then canvas click expands + scrolls to the card; card click highlights its pieces
  await p.click('#collapseAll'); await wait(200);
  ok(await p.evaluate(() => [...document.querySelectorAll('#items .item')].every(c => c.classList.contains('collapsed') && getComputedStyle(c.querySelector('.ibody')).display === 'none')), 'Collapse all: every card is a one-line row (thumb, name, size, qty)');
  const rowTxt = await p.evaluate(() => document.querySelector('#items .item .isum').textContent); ok(/×.*·\s*×\d/.test(rowTxt), 'collapsed row shows size and qty: ' + rowTxt);
  await p.evaluate(() => window.CST.curSheet = 0); await p.evaluate(() => window.CST.refresh(false)); await wait(300);
  const donut = await p.evaluate(() => window.CST.layout.sheets[0].find(e => e.it.name === 'donut_badge.png').key), de = await ent(donut);
  const ds = await p.evaluate((x, y) => window.T.screen(x, y), de.x + de.w / 2, de.y + de.h / 2); await p.mouse.click(ds.x, ds.y); await wait(700);
  const cardState = await p.evaluate(() => { const c = document.querySelector('.item.sel'), r = c && c.getBoundingClientRect(); return c && { name: c.querySelector('.iname').textContent, collapsed: c.classList.contains('collapsed'), inView: r.top >= 0 && r.bottom <= innerHeight + 1, sel: window.CST.sel }; });
  ok(cardState && cardState.name === 'donut_badge.png' && !cardState.collapsed && cardState.inView, 'clicking a piece highlights, expands and scrolls to its card ' + JSON.stringify(cardState));
  await p.click('#expandAll'); await wait(200);
  ok(await p.evaluate(() => [...document.querySelectorAll('#items .item')].every(c => !c.classList.contains('collapsed'))), 'Expand all');
  const heartHead = await p.evaluateHandle(() => [...document.querySelectorAll('.item')].find(c => c.querySelector('.iname').textContent === 'heart.svg').querySelector('.iname'));
  await heartHead.click(); await wait(300);
  ok(await p.evaluate(() => { const s = window.CST.sel, it = window.CST.items.find(i => i.name === 'heart.svg'); return s.itemId === it.id && s.key === null && document.querySelector('.item.sel .iname').textContent === 'heart.svg'; }), 'clicking a card selects that image (its pieces get a highlight outline on the canvas)');

  // 9) aspect-ratio link
  const card = async (n) => p.evaluateHandle((n) => [...document.querySelectorAll('.item')].find(c => c.querySelector('.iname').textContent === n), n);
  let c = await card('label_square.jpg'); let it0 = await p.evaluate(() => { const i = window.CST.items.find(i => i.name === 'label_square.jpg'); return { w: i.wIn, h: i.hIn, lock: i.lockAR }; });
  let w = await c.$('[data-f=w] input'); await w.click({ clickCount: 3 }); await w.type('2.5'); await w.evaluate(e => e.dispatchEvent(new Event('change'))); await wait(600);
  let it1 = await p.evaluate(() => { const i = window.CST.items.find(i => i.name === 'label_square.jpg'), c = [...document.querySelectorAll('.item')].find(c => c.querySelector('.iname').textContent === i.name); return { w: i.wIn, h: i.hIn, pct: window.CST.pctOf(i), uiH: +c.querySelector('[data-f=h] input').value, uiPct: +c.querySelector('[data-f=pct] input').value }; });
  ok(it0.lock === true && Math.abs(it1.h / it1.w - it0.h / it0.w) < 1e-9 && Math.abs(it1.uiH - +it1.h.toFixed(6)) < 1e-3 && Math.abs(it1.uiPct - it1.pct) < 0.06, `link ON (default): W 2.5 → H ${it1.h.toFixed(4)} (ratio kept), Scale ${it1.uiPct}%`);
  c = await card('label_square.jpg'); await (await c.$('.link')).click(); await wait(500); c = await card('label_square.jpg');
  w = await c.$('[data-f=w] input'); await w.click({ clickCount: 3 }); await w.type('3'); await w.evaluate(e => e.dispatchEvent(new Event('change'))); await wait(600);
  let it2 = await p.evaluate(() => { const i = window.CST.items.find(i => i.name === 'label_square.jpg'); return { w: i.wIn, h: i.hIn, lock: i.lockAR }; });
  ok(!it2.lock && Math.abs(it2.w - 3) < 1e-9 && Math.abs(it2.h - it1.h) < 1e-9, `link OFF: W 3 leaves H at ${it2.h.toFixed(4)}`);
  c = await card('label_square.jpg'); await (await c.$('.link')).click(); await wait(500); c = await card('label_square.jpg');
  let hh = await c.$('[data-f=h] input'); await hh.click({ clickCount: 3 }); await hh.type('1.5'); await hh.evaluate(e => e.dispatchEvent(new Event('change'))); await wait(600);
  let it3 = await p.evaluate(() => { const i = window.CST.items.find(i => i.name === 'label_square.jpg'); return { w: i.wIn, h: i.hIn }; });
  ok(Math.abs(it3.w - 1.5 * it2.w / it2.h) < 1e-9, `re-linked: H 1.5 → W ${it3.w.toFixed(4)} (keeps the ratio set while unlinked)`);
  ok(!(await check()).length, 'size changes keep the hand-placed layout legal ' + JSON.stringify(await check()));

  // 10) filter, summary, fill
  await p.type('#ifilter', 'star'); await wait(200);
  ok(await p.evaluate(() => [...document.querySelectorAll('.item')].filter(c => c.style.display !== 'none').map(c => c.querySelector('.iname').textContent).join() === 'star_sticker.png' && /1 of 6/.test(document.querySelector('#filterNote').textContent)), 'filter box shows only matching cards');
  await p.click('#ifilter', { clickCount: 3 }); await p.keyboard.press('Backspace'); await wait(200);
  const summ = await p.$eval('#imgSummary', e => e.textContent); ok(/^6 images · \d+ pieces · 2 sheets$/.test(summ), 'sidebar summary: ' + summ);
  const fillBefore = await p.evaluate(() => ({ q: window.CST.items.find(i => i.name === 'heart.svg').qty, n: window.CST.layout.sheets.length }));
  c = await card('heart.svg'); await (await c.$('.fill')).click(); await wait(1200);
  const fillAfter = await p.evaluate(() => ({ q: window.CST.items.find(i => i.name === 'heart.svg').qty, n: window.CST.layout.sheets.length, placed: window.CST.layout.sheets.flat().length, want: window.CST.items.reduce((t, i) => t + i.qty, 0) }));
  ok(fillAfter.q > fillBefore.q && fillAfter.n === fillBefore.n && fillAfter.placed === fillAfter.want && !(await check()).length, `Fill (hand-placed mode): heart qty ${fillBefore.q} → ${fillAfter.q}, still ${fillAfter.n} sheets, all placed`);

  // 11) the old status block is gone; compact chips + popover keep the information
  const st = await p.evaluate(() => ({ statusVisible: !!document.querySelector('#status').offsetParent, chips: [...document.querySelectorAll('#chips .chip')].filter(c => c.offsetParent).map(c => c.textContent), above: document.querySelector('.stage').firstElementChild.className }));
  ok(!st.statusVisible && st.above === 'stagebar' && st.chips.length >= 2, 'status block removed from above the toolbar; chips: ' + st.chips.join(' | '));
  await p.click('#chipCal'); await wait(200);
  const pop = await p.evaluate(() => ({ vis: !document.querySelector('#statusPop').hidden, txt: document.querySelector('#statusPop').innerText }));
  ok(pop.vis && /Calibration (ON|OFF)/.test(pop.txt) && /pieces? on \d sheet/.test(pop.txt), 'chip opens a popover with the full layout + calibration details');
  await p.mouse.click(5, 990); await wait(100); ok(await p.evaluate(() => document.querySelector('#statusPop').hidden), 'popover closes on outside click');

  // 12) sheet panel collapse (remembered in settings)
  await p.click('#settings > h2'); await wait(200);
  const sc = await p.evaluate(() => ({ c: document.querySelector('#settings').classList.contains('collapsed'), sum: document.querySelector('#sheetSum').textContent, saved: JSON.parse(localStorage.getItem('cst.settings')).sheetCollapsed }));
  ok(sc.c && sc.saved === true && /Letter/.test(sc.sum), 'Sheet panel collapses to one line: ' + sc.sum);

  // 13) exports: manual positions come out exactly (plain, then with calibration ON)
  async function exportCheck(label) {
    const r = await p.evaluate(async () => { const C = window.CST, L = C.computeLayout(), sh = L.sh, toB64 = (ab) => { let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      const cal = C.getCal(), k = C.S.applyCorr ? { ex: cal.ex || 1, ey: cal.ey || 1 } : { ex: 1, ey: 1 }, P = window.CSTCore.printMap(k.ex, k.ey, sh.w / 2, sh.h / 2);
      const f = window.CSTCore.makeCorrector(C.S.applyCorr ? C.getCorr() : window.CSTCore.IDENTITY, sh.w / 2, sh.h / 2);
      const exp = L.sheets.map(s => s.map(e => { const pr = e.p.print, [a, b2] = P(e.x + pr.x, e.y + pr.y);
        const loops = e.p.loops.map(l => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const sg of l) for (let i = 1; i + 1 < sg.length; i += 2) { const [X, Y] = f(sg[i] + e.x, sg[i + 1] + e.y); x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); } return [x0, y0, x1, y1].map((v, j) => (v - C.S.inset) * 72); });
        return { key: e.key, img: { x: a * 72, y: (sh.h - b2 - pr.h * k.ey) * 72, w: pr.w * k.ex * 72, h: pr.h * k.ey * 72 }, loops }; }));
      return { pdf: toB64(C.buildPDF().output('arraybuffer')), svgs: C.buildSVGs(), exp, manual: L.manual }; });
    const pl = pdfPlacements(Buffer.from(r.pdf, 'base64')); let worstImg = 0, worstCut = 0, missing = 0;
    r.exp.forEach((s, si) => { const got = pl[si] || []; s.forEach(e => { const m = got.map(g => Math.max(Math.abs(g.x - e.img.x), Math.abs(g.y - e.img.y), Math.abs(g.w - e.img.w), Math.abs(g.h - e.img.h))).sort((a, b) => a - b)[0]; if (m == null) missing++; else worstImg = Math.max(worstImg, m); });
      const boxes = svgSubpathBoxes(r.svgs[si]).slice(4); const want = s.flatMap(e => e.loops);
      if (boxes.length !== want.length) missing += Math.abs(boxes.length - want.length);
      for (const w of want) { const m = boxes.map(bx => Math.max(...bx.map((v, j) => Math.abs(v - w[j])))).sort((a, b) => a - b)[0]; worstCut = Math.max(worstCut, m); } });
    ok(r.manual && !missing && worstImg < 0.01 && worstCut < 0.01, `${label}: ${r.exp.flat().length} hand-placed pieces on ${r.exp.length} sheets – PDF image placement worst error ${worstImg.toFixed(4)} pt, SVG cut outline worst error ${worstCut.toFixed(4)} pt`);
    return r; }
  await p.evaluate(() => { window.CST.S.applyCorr = false; window.CST.refresh(false); }); await wait(400);
  await exportCheck('export, calibration OFF');
  await p.evaluate(() => { const C = window.CST, c = C.getCal(); c.Q = { v: 2, a11: 0.9745, a12: 0.0035, a21: -0.0035, a22: 0.972, tx: -0.05, ty: -0.09 }; c.ex = 1.0262; c.ey = 1.0288; c.mode = 'compensate'; c.status = 'verify'; C.saveCal(c); C.S.applyCorr = true; C.refresh(false); }); await wait(600);
  ok(!(await check()).length, 'calibration ON (margins grow): hand-placed pieces re-legalised, no overlaps / out of bounds');
  await exportCheck('export, calibration ON (print +2.62%/+2.88%, cut corrected)');
  // pinning an auto layout without moving anything gives byte-identical cut files and identical PDF placements
  const pinSame = await p.evaluate(() => { const C = window.CST; C.manual = null; C.computeLayout(); const a = C.buildSVGs().join(''), pa = C.layout.sheets.flat().map(e => [e.key, e.x, e.y, e.rot]);
    C.pinLayout(); C.computeLayout(); const bb = C.buildSVGs().join(''), pb = C.layout.sheets.flat().map(e => [e.key, e.x, e.y, e.rot]); return a === bb && JSON.stringify(pa) === JSON.stringify(pb); });
  ok(pinSame, 'auto-pack → hand-placed without moving: identical cut SVGs and positions');
  await p.evaluate(() => window.CST.refresh(false)); await wait(300);

  // 14) Reset to auto-pack
  await dragTo((await p.evaluate(() => window.CST.layout.sheets[0][0].key)), B.x0 + 0.5, B.y1 - 2.2);
  await p.click('#resetAuto'); await wait(500);
  ok(!(await p.evaluate(() => window.CST.layout.manual)) && !(await check()).length && !(await p.$eval('#chipManual', c => !!c.offsetParent)), 'Reset to auto-pack drops hand placement');

  // 15) project round trip keeps hand placement, collapsed cards and the link state
  await dragTo((await p.evaluate(() => window.CST.layout.sheets[0][0].key)), B.x0 + 0.5, B.y1 - 2.2);
  await p.evaluate(() => { window.CST.items[1].collapsed = true; window.CST.items[2].lockAR = false; });
  const saved = await p.evaluate(async () => { const o = URL.createObjectURL; let blob; URL.createObjectURL = (b) => { blob = b; return 'data:,'; }; await window.CST.saveProject(); URL.createObjectURL = o; return await blob.text(); });
  const posA = await p.evaluate(() => window.CST.layout.sheets.map(s => s.map(e => [e.it.name, +e.key.split('#')[1], +e.x.toFixed(6), +e.y.toFixed(6), e.rot])));
  await p.evaluate(async (txt) => { await window.CST.loadProject(new File([txt], 'p.json')); }, saved); await wait(2500);
  const posB = await p.evaluate(() => window.CST.layout.sheets.map(s => s.map(e => [e.it.name, +e.key.split('#')[1], +e.x.toFixed(6), +e.y.toFixed(6), e.rot])));
  const flags = await p.evaluate(() => [window.CST.items[1].collapsed, window.CST.items[2].lockAR, document.querySelectorAll('.item.collapsed').length]);
  ok(JSON.stringify(posA) === JSON.stringify(posB) && flags[0] === true && flags[1] === false && flags[2] === 1, 'Save / Open project restores hand-placed positions, collapsed cards and unlinked W/H');

  // screenshots
  await p.evaluate(() => { const C = window.CST; C.S.sheetCollapsed = false; document.querySelector('#settings').classList.remove('collapsed'); C.curSheet = 0; C.refresh(false); }); await wait(500);
  await p.evaluate(() => { [...document.querySelectorAll('.item')].forEach((c, i) => { if (i % 2 === 0 || i === 5) c.querySelector('.chev').click(); }); });
  const de2 = await p.evaluate(() => { const e = window.CST.layout.sheets[0].find(e => e.it.name === 'donut_badge.png') || window.CST.layout.sheets[0][0]; return window.T.screen(e.x + e.p.cutW / 2, e.y + e.p.cutH / 2); });
  await p.mouse.click(de2.x, de2.y); await wait(900);
  await p.screenshot({ path: path.join(OUT, 'ui_layout_canvas.png') });
  await p.click('#collapseAll'); await wait(200); await p.click('#chipCal'); await wait(300);
  await p.screenshot({ path: path.join(OUT, 'ui_collapsed_status_popover.png') });
  await p.mouse.click(5, 990); await p.evaluate(() => window.CST.setZoom(2)); await wait(500);
  // simulate a drag in progress onto another piece for the "blocked" red feedback
  const pr = await p.evaluate(() => { const s = window.CST.layout.sheets[0], a = s[0], o = s[1]; const box = document.querySelector('.canvasbox'); box.scrollTop = Math.max(0, a.y * window.CST.view.sc - 120); box.scrollLeft = Math.max(0, a.x * window.CST.view.sc - 120);
    return { a: window.T.screen(a.x + a.p.cutW / 2, a.y + a.p.cutH / 2), o: window.T.screen(o.x + o.p.cutW / 2, o.y + o.p.cutH / 2) }; }); await wait(200);
  await p.mouse.move(pr.a.x, pr.a.y); await p.mouse.down(); await p.mouse.move((pr.a.x + pr.o.x) / 2, (pr.a.y + pr.o.y) / 2, { steps: 8 }); await wait(300);
  await p.screenshot({ path: path.join(OUT, 'ui_zoom_drag_blocked.png') }); await p.mouse.up(); await wait(400);
  ok(!(await check()).length, 'zoomed drag (2×) onto a neighbour still ends legal');

  // touch drag (pointer events from a touchscreen)
  await p.evaluate(() => window.CST.setZoom(1)); await wait(400);
  const tk = await p.evaluate(() => { const C = window.CST; C.curSheet = C.layout.sheets.length - 1; C.refresh(false); return C.layout.sheets[C.layout.sheets.length - 1][0].key; }); await wait(300), te = await ent(tk), tt = await p.evaluate((k) => window.T.free(k, 1.5), tk);
  if (tt) { const cdp = await p.target().createCDPSession(); const A = await p.evaluate((x, y) => window.T.screen(x, y), te.x + te.w / 2, te.y + te.h / 2), Z = await p.evaluate((x, y) => window.T.screen(x, y), tt.x + te.w / 2, tt.y + te.h / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: A.x, y: A.y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: A.x + (Z.x - A.x) * i / 10, y: A.y + (Z.y - A.y) * i / 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(500); const e2 = await ent(tk);
    ok(Math.abs(e2.x - tt.x) < 0.11 && Math.abs(e2.y - tt.y) < 0.11 && !(await check()).length, `touch drag moves a piece (${te.x.toFixed(2)},${te.y.toFixed(2)} → ${e2.x.toFixed(2)},${e2.y.toFixed(2)})`); } else ok(false, 'touch drag: no free spot to test');

  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
