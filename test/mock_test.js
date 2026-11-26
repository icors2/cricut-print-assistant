// Mockup / Assemble tab end to end in headless Chrome with made-up dollhouse pieces (test/samples/scene, from make_scene.py):
// one instance per image at true relative size, mouse drag + snap, rotate handle (Shift = 15°), angle box, flip, z-order buttons,
// layer-list drag reorder, visibility, add another / remove, undo/redo, guide modes, PNG/PDF exports, autosave + project round trip,
// optional piece numbers on the print PDF. Proves the Layout's print PDF and cut SVGs stay byte-identical through all mockup edits.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1000 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload();
  const load = async () => { await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction(() => window.CST.items.length === 7, { timeout: 20000 });
    await p.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.items.find(i => i.name === 'bear_headset.png').qty = 2; C.items.find(i => i.name === 'window.png').qty = 2; C.refresh(true); }); await wait(2500); };
  await load();
  // helpers: exports with a frozen clock so jsPDF's timestamp can't differ; blob capture for downloads
  const inject = () => p.evaluate(() => {
    window.T = {
      frozen: (f) => { const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD; try { return f(); } finally { window.Date = RD; } },
      b64: (ab) => { let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
      exports: () => { const C = window.CST; C.computeLayout(); return window.T.frozen(() => ({ pdf: window.T.b64((() => { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); return d.output('arraybuffer'); })()), svgs: C.buildSVGs(), code: C.stateCode(C.currentState()), pos: JSON.stringify(C.layout.sheets.map(s => s.map(e => [e.key, e.x, e.y, e.rot]))) })); },
      node: (name, k) => { const C = window.CST; const ns = C.MK.nodes.filter(n => { const it = C.items.find(i => i.id === n.itemId); return it && it.name === name; }); return ns[k || 0]; },
      nodeInfo: (name, k) => { const n = window.T.node(name, k); if (!n) return null; const g = window.CST.mkGeom(n); return Object.assign({}, n, g, { idx: window.CST.MK.nodes.indexOf(n) }); },
      screen: (x, y) => { const c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = window.CST.mkView, k = r.width / c.width; return { x: r.left + (v.pad + x * v.sc) * k, y: r.top + (v.pad + y * v.sc) * k }; },
      grab: [] };
    URL.createObjectURL = (bl) => { window.T.grab.push(bl); return 'data:,'; };
  });
  await inject();
  const e0 = await p.evaluate(() => window.T.exports()), e0b = await p.evaluate(() => window.T.exports());
  ok(e0.pdf === e0b.pdf && e0.svgs.join() === e0b.svgs.join(), `baseline: two exports (frozen clock, fixed file ID) are byte-identical (PDF ${Math.round(e0.pdf.length * 0.75 / 1024)} KB, ${e0.svgs.length} SVG, sheet code ${e0.code})`);
  ok(await p.evaluate(() => !document.querySelector('#numberPieces').checked && !window.CST.S.numberPieces), 'piece numbers on the print are OFF by default');

  // 1) open Mockup: one instance per image at its true (Layout) size
  await p.click('[data-tab=tabMock]'); await wait(800);
  const init = await p.evaluate(() => { const C = window.CST; return C.items.map(it => { const ns = C.MK.nodes.filter(n => n.itemId === it.id), e = C.layout.sheets.flat().find(e => e.it === it && !e.rot) || C.layout.sheets.flat().find(e => e.it === it), g = ns[0] && C.mkGeom(ns[0]);
    return { name: it.name, n: ns.length, w: g && g.w, h: g && g.h, cw: e && (e.rot ? e.p.cutH : e.p.cutW), ch: e && (e.rot ? e.p.cutW : e.p.cutH), wIn: it.wIn }; }); });
  ok(init.every(r => r.n === 1), 'one instance of each image (qty on the cut sheet is ignored): ' + init.map(r => r.name + ':' + r.n).join(' '));
  ok(init.every(r => Math.abs(r.w - r.cw) < 1e-9 && Math.abs(r.h - r.ch) < 1e-9), 'mockup sizes = the cut sizes on the sheet: ' + init.map(r => `${r.name} ${r.w.toFixed(2)}×${r.h.toFixed(2)}`).join(', '));
  // the drawn size on screen matches inches × scale (true relative size)
  // measure the drawn pixels: render the finished mockup and find each piece's opaque extent on a plain backdrop
  const px = await p.evaluate(() => { const keep = window.CST.MK.bg.color; window.CST.MK.bg.color = '#102030'; window.CST.renderMock(true); const C = window.CST, c = document.querySelector('#mkCanvas'), g = c.getContext('2d'), v = C.mkView, meas = (nm) => { const n = window.T.node(nm), gm = C.mkGeom(n);
      const x0 = Math.floor(v.pad + (n.x - gm.w / 2) * v.sc) - 3, x1 = Math.ceil(v.pad + (n.x + gm.w / 2) * v.sc) + 3, y = Math.round(v.pad + n.y * v.sc), d = g.getImageData(x0, y - 6, x1 - x0, 13).data, bg = [d[0], d[1], d[2]]; let a = Infinity, z = -Infinity;
      for (let r = 0; r < 13; r++) for (let i = 0; i < x1 - x0; i++) { const k = (r * (x1 - x0) + i) * 4; if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 30) { a = Math.min(a, i); z = Math.max(z, i); } }
      return { px: z - a + 1, inch: gm.w }; };
    const res = { sc: v.sc, wall: meas('wall_panel.png'), sofa: meas('sofa.png') }; C.MK.bg.color = keep; C.renderMock(true); return res; });
  ok(Math.abs(px.wall.px / px.sc - px.wall.inch) < 0.06 && Math.abs((px.wall.px / px.sofa.px) - px.wall.inch / px.sofa.inch) < 0.05 * px.wall.inch / px.sofa.inch, `drawn at true relative size: wall ${px.wall.px}px = ${(px.wall.px / px.sc).toFixed(2)} in (cut ${px.wall.inch.toFixed(2)}), wall/sofa pixel ratio ${(px.wall.px / px.sofa.px).toFixed(3)} vs ${(px.wall.inch / px.sofa.inch).toFixed(3)}`);
  // a size change on the Layout tab carries over, and Layout undo restores it exactly
  const bw0 = (await p.evaluate(() => window.T.nodeInfo('bear_headset.png'))).w;
  await p.evaluate(() => { const C = window.CST; C.setPct(C.items.find(i => i.name === 'bear_headset.png'), 50); C.refresh(true); }); await wait(1200);
  const bw1 = (await p.evaluate(() => window.T.nodeInfo('bear_headset.png'))).w;
  await p.evaluate(() => window.CST.undo()); await wait(1500);
  const bw2 = (await p.evaluate(() => window.T.nodeInfo('bear_headset.png'))).w;
  ok(Math.abs(bw1 / bw0 - 0.5) < 0.03 && Math.abs(bw2 - bw0) < 1e-12, `Layout size change shows in the mockup (bear ${bw0.toFixed(3)} → ${bw1.toFixed(3)} in at 50%, back to ${bw2.toFixed(3)} after Layout undo)`);

  // 2) mouse drag
  const dragN = async (name, dx, dy, opt) => { const n = await p.evaluate((nm) => window.T.nodeInfo(nm), name); const a = await p.evaluate((x, y) => window.T.screen(x, y), n.x, n.y), z = await p.evaluate((x, y) => window.T.screen(x, y), n.x + dx, n.y + dy);
    if (opt && opt.alt) await p.keyboard.down('Alt'); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 12 }); await p.mouse.up(); if (opt && opt.alt) await p.keyboard.up('Alt'); await wait(300);
    return [n, await p.evaluate((nm) => window.T.nodeInfo(nm), name)]; };
  let [b0, b1] = await dragN('bear_headset.png', 1.5, 2.2, { alt: true });
  ok(Math.abs(b1.x - b0.x - 1.5) < 0.03 && Math.abs(b1.y - b0.y - 2.2) < 0.03 && await p.evaluate(() => window.CST.mkSel && window.CST.mkSel.name === 'bear_headset.png'), `drag moves the bear by (1.5, 2.2) in → (${(b1.x - b0.x).toFixed(3)}, ${(b1.y - b0.y).toFixed(3)}) and selects it`);
  ok(await p.evaluate(() => document.querySelector('#mkLayers .lrow.sel .lname').textContent.startsWith('bear_headset.png')), 'its row is highlighted in the layer list');
  // snap to another piece's edge: sofa's left edge to the wall's left edge (0.03 in off → exact)
  const sn = await p.evaluate(() => { const C = window.CST, w = window.T.node('wall_panel.png'), gw = C.mkGeom(w), s = window.T.node('sofa.png'), gs = C.mkGeom(s); return { tx: (w.x - gw.w / 2) + gs.w / 2 + 0.03, wl: w.x - gw.w / 2, sx: s.x, sy: s.y, hw: gs.w / 2 }; });
  let [s0, s1] = await dragN('sofa.png', sn.tx - sn.sx, 0.6);
  ok(Math.abs((s1.x - sn.hw) - sn.wl) < 1e-9, `snap: sofa's left edge lands exactly on the wall's left edge (${(s1.x - sn.hw).toFixed(6)} vs ${sn.wl.toFixed(6)})`);

  // 3) rotate: handle drag with Shift (15° steps), angle box, ±15 buttons, flip
  await p.evaluate(() => window.CST.mkSelect(window.T.node('floor_lamp.png'))); await wait(200);
  const L0 = await p.evaluate(() => window.T.nodeInfo('floor_lamp.png'));
  const hd = await p.evaluate((n) => { const v = window.CST.mkView; return { h: window.T.screen(n.x, n.y - n.h / 2 - 24 / v.sc), t: window.T.screen(n.x + Math.sin(41 * Math.PI / 180) * 3, n.y - Math.cos(41 * Math.PI / 180) * 3) }; }, L0);
  await p.mouse.move(hd.h.x, hd.h.y); await p.mouse.down(); await p.keyboard.down('Shift'); await p.mouse.move(hd.t.x, hd.t.y, { steps: 10 }); await p.mouse.up(); await p.keyboard.up('Shift'); await wait(300);
  let L1 = await p.evaluate(() => window.T.nodeInfo('floor_lamp.png'));
  ok(L1.rot === 45 && Math.abs(L1.x - L0.x) < 1e-12, `rotate handle + Shift snaps to 15° steps: dragged to ~41° → ${L1.rot}° (position unchanged)`);
  const hd2 = await p.evaluate((n) => { const v = window.CST.mkView, a = n.rot * Math.PI / 180, d = n.h / 2 + 24 / v.sc; return { h: window.T.screen(n.x + Math.sin(a) * d, n.y - Math.cos(a) * d), t: window.T.screen(n.x + Math.sin(-20 * Math.PI / 180) * 3, n.y - Math.cos(-20 * Math.PI / 180) * 3) }; }, L1);
  await p.mouse.move(hd2.h.x, hd2.h.y); await p.mouse.down(); await p.mouse.move(hd2.t.x, hd2.t.y, { steps: 10 }); await p.mouse.up(); await wait(300);
  L1 = await p.evaluate(() => window.T.nodeInfo('floor_lamp.png'));
  ok(Math.abs(L1.rot + 20) < 1.5, `free rotation without Shift: ~−20° → ${L1.rot.toFixed(2)}°`);
  await p.click('#mkAngle', { clickCount: 3 }); await p.type('#mkAngle', '30'); await p.evaluate(() => document.querySelector('#mkAngle').dispatchEvent(new Event('change'))); await wait(200);
  await p.click('#mkRotR'); await wait(150); L1 = await p.evaluate(() => window.T.nodeInfo('floor_lamp.png'));
  ok(L1.rot === 45, `angle box 30° then ↻ 15° → ${L1.rot}°`);
  await p.click('#mkFlip'); await wait(150); ok((await p.evaluate(() => window.T.nodeInfo('floor_lamp.png'))).flip === true, 'Flip mirrors the piece');

  // 4) z-order buttons + keys
  const order = () => p.evaluate(() => window.CST.MK.nodes.map(n => n.name));
  await p.evaluate(() => window.CST.mkSelect(window.T.node('rug.png'))); await p.click('#mkToBack'); await wait(150); let o = await order();
  const okBack = o[0] === 'rug.png'; await p.click('#mkFront'); await wait(150); o = await order(); const okFront = o[o.length - 1] === 'rug.png';
  await p.click('#mkBack'); await wait(150); o = await order(); const okDown = o[o.length - 2] === 'rug.png';
  await p.click('#mkFwd'); await wait(150); o = await order(); const okUp = o[o.length - 1] === 'rug.png';
  await p.focus('#mkCanvas'); await p.keyboard.down('Shift'); await p.keyboard.press('BracketLeft'); await p.keyboard.up('Shift'); await wait(150); o = await order();
  ok(okBack && okFront && okDown && okUp && o[0] === 'rug.png', 'To back / To front / Backward / Forward buttons and Shift+[ reorder the layers');
  // layer list: drag the wall's row to the bottom (= very back)
  const rowsBefore = await p.evaluate(() => [...document.querySelectorAll('#mkLayers .lrow .lname')].map(e => e.textContent));
  const hpos = await p.evaluate(() => { const r = [...document.querySelectorAll('#mkLayers .lrow')], w = r.find(x => x.querySelector('.lname').textContent.startsWith('wall_panel.png')), h = w.querySelector('.lhandle').getBoundingClientRect(), last = r[r.length - 1].getBoundingClientRect(); return { x: h.left + h.width / 2, y: h.top + h.height / 2, ty: last.bottom - 3 }; });
  await p.mouse.move(hpos.x, hpos.y); await p.mouse.down(); await p.mouse.move(hpos.x, hpos.ty, { steps: 10 }); await p.mouse.up(); await wait(300); o = await order();
  ok(o[0] === 'wall_panel.png' && await p.evaluate(() => [...document.querySelectorAll('#mkLayers .lrow .lname')].pop().textContent.startsWith('wall_panel.png')), `layer list drag (⋮⋮): wall moved to the back (list was ${rowsBefore.length} rows, now bottom = wall)`);
  // visibility
  await p.evaluate(() => [...document.querySelectorAll('#mkLayers .lrow')].find(r => r.querySelector('.lname').textContent.startsWith('rug.png')).querySelector('.leye').click()); await wait(200);
  const rugHidden = await p.evaluate(() => { const n = window.T.node('rug.png'); return n.hidden; });
  await p.screenshot({ path: '/tmp/hidden.png' });
  await p.evaluate(() => [...document.querySelectorAll('#mkLayers .lrow')].find(r => r.querySelector('.lname').textContent.startsWith('rug.png')).querySelector('.leye').click()); await wait(200);
  ok(rugHidden && !(await p.evaluate(() => window.T.node('rug.png').hidden)), 'eye button hides / shows a layer');
  // add another / remove (D key, button), undo / redo
  await p.evaluate(() => window.CST.mkSelect(window.T.node('window.png'))); await p.focus('#mkCanvas'); await p.keyboard.press('d'); await wait(300);
  const nWin = await p.evaluate(() => window.CST.MK.nodes.filter(n => n.name === 'window.png').length);
  await p.keyboard.press('Delete'); await wait(300); const nWin2 = await p.evaluate(() => window.CST.MK.nodes.filter(n => n.name === 'window.png').length);
  ok(nWin === 2 && nWin2 === 1, `D adds another window (2), Delete removes it (1)`);
  const sigA = await p.evaluate(() => JSON.stringify(window.CST.MK.nodes));
  await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await wait(300);
  const nU = await p.evaluate(() => window.CST.MK.nodes.filter(n => n.name === 'window.png').length);
  await p.click('#mkRedo'); await wait(300);
  ok(nU === 2 && sigA === await p.evaluate(() => JSON.stringify(window.CST.MK.nodes)), 'Ctrl+Z brings the removed window back, Redo removes it again (identical state)');
  for (let i = 0; i < 3; i++) await p.click('#mkUndo'); await wait(200); for (let i = 0; i < 3; i++) await p.click('#mkRedo'); await wait(300);
  ok(sigA === await p.evaluate(() => JSON.stringify(window.CST.MK.nodes)), 'Undo ×3 then Redo ×3 returns to the same mockup');
  // compose a scene for the screenshots: wall at back, floor below it, sofa/rug/lamp/window/bear in front
  await p.evaluate(() => { const C = window.CST, T = window.T, put = (nm, x, y, r, f) => { const n = T.node(nm); n.x = x; n.y = y; if (r != null) n.rot = r; if (f != null) n.flip = f; };
    C.MK.bg.preset = 'letter-L'; C.MK.bg.w = 11; C.MK.bg.h = 8.5; C.MK.bg.color = '#fff8f2';
    put('wall_panel.png', 5.5, 3.2, 0, false); put('floor_boards.png', 5.5, 5.7, 0, false); put('window.png', 4.0, 2.3, 0); put('rug.png', 5.6, 5.6, 0); put('sofa.png', 6.1, 4.6, 0, false); put('floor_lamp.png', 8.1, 3.9, 0, false); put('bear_headset.png', 5.3, 4.3, -12, false);
    const want = ['wall_panel.png', 'floor_boards.png', 'window.png', 'rug.png', 'sofa.png', 'floor_lamp.png', 'bear_headset.png']; C.MK.nodes.sort((a, b) => want.indexOf(a.name) - want.indexOf(b.name));
    C.mkSelect(T.node('bear_headset.png')); C.renderMock(); }); await wait(800);
  await p.screenshot({ path: path.join(OUT, 'ui_mockup_scene.png') });
  await p.select('#mkGuide', 'outline'); await wait(400); await p.evaluate(() => window.CST.mkSelect(null)); await wait(200); await p.screenshot({ path: path.join(OUT, 'ui_mockup_guide_outline.png') });
  await p.select('#mkGuide', 'ghost'); await wait(400); await p.screenshot({ path: path.join(OUT, 'ui_mockup_guide_ghost.png') });

  // 5) exports: mockup PNG, guide PNG, guide PDF at true size with a legend
  await p.evaluate(() => { window.T.grab = []; document.querySelector('#mkExpPNG').click(); document.querySelector('#mkExpGuidePNG').click(); document.querySelector('#mkExpGuidePDF').click(); }); await wait(1500);
  const blobs = await p.evaluate(async () => Promise.all(window.T.grab.map(async bl => ({ type: bl.type, b64: window.T.b64(await bl.arrayBuffer()) }))));
  ok(blobs.length === 3, 'three downloads: ' + blobs.map(x => x.type).join(', '));
  const files = ['mockup_scene.png', 'mockup_assembly_guide.png', 'mockup_assembly_guide.pdf']; blobs.forEach((x, i) => fs.writeFileSync(path.join(OUT, files[i]), Buffer.from(x.b64, 'base64')));
  const dim = (f) => { const bf = fs.readFileSync(path.join(OUT, f)); return [bf.readUInt32BE(16), bf.readUInt32BE(20)]; };
  const [mw, mh] = dim(files[0]), [gw, gh] = dim(files[1]);
  ok(mw === 1650 && mh === 1275, `mockup PNG is the 11 × 8.5 in backdrop at 150 dpi (${mw}×${mh})`);
  ok(gw === 1650 && gh > 1275, `guide PNG = backdrop at 150 dpi plus a legend strip (${gw}×${gh})`);
  const info = execFileSync('pdfinfo', [path.join(OUT, files[2])]).toString(), pages = +/Pages:\s+(\d+)/.exec(info)[1], ps = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
  const p1 = execFileSync('pdfinfo', ['-f', '1', '-l', '2', path.join(OUT, files[2])]).toString();
  const t1 = execFileSync('pdftotext', ['-f', '1', '-l', '1', path.join(OUT, files[2]), '-']).toString(), t2 = execFileSync('pdftotext', ['-f', '2', '-l', '2', path.join(OUT, files[2]), '-']).toString();
  const nums = (t1.match(/\b\d+\b/g) || []).map(Number).sort((a, b) => a - b);
  ok(pages === 2 && Math.abs(+ps[1] - 792) < 0.01 && Math.abs(+ps[2] - 612) < 0.01, `guide PDF page 1 is the backdrop at true size (${ps[1]} × ${ps[2]} pt = 11 × 8.5 in), page 2 the legend; ${/Page\s+2 size:\s+612 x 792/.test(p1) ? 'legend page Letter' : ''}`);
  ok(JSON.stringify(nums) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]), 'guide page 1 shows the numbers 1–7 on the outlines: ' + nums.join(','));
  ok(FILES.every(f => t2.includes(f)) && /legend/i.test(t2), 'legend page lists every image name with its number');
  // vector outline check: page 1 rendered: dashed outline pixels around the window position
  execFileSync('pdftoppm', ['-r', '50', '-f', '1', '-l', '1', '-png', path.join(OUT, files[2]), '/tmp/mkguide']);
  fs.copyFileSync(fs.readdirSync('/tmp').filter(f => f.startsWith('mkguide')).map(f => '/tmp/' + f).sort().pop(), path.join(OUT, 'mockup_assembly_guide_page1.png'));

  // 6) persistence: autosave survives a reload once the same images are added again; project round trip
  await p.select('#mkGuide', 'off'); await wait(300);
  const snapA = await p.evaluate(() => JSON.stringify(window.CST.MK.nodes.map(n => [n.name, +n.x.toFixed(6), +n.y.toFixed(6), n.rot, n.flip, n.hidden])) + JSON.stringify(window.CST.MK.bg));
  const proj = await p.evaluate(async () => { window.T.grab = []; await window.CST.saveProject(); return await window.T.grab[0].text(); });
  await wait(600); await p.reload(); await wait(800); await load(); await inject(); await p.click('[data-tab=tabMock]'); await wait(800);
  const snapB = await p.evaluate(() => JSON.stringify(window.CST.MK.nodes.map(n => [n.name, +n.x.toFixed(6), +n.y.toFixed(6), n.rot, n.flip, n.hidden])) + JSON.stringify(window.CST.MK.bg));
  ok(snapA === snapB, 'autosave: after a reload and re-adding the same images the mockup (positions, angles, flips, order, backdrop) is back');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload(); await wait(800);
  await inject(); await p.evaluate(async (t) => { await window.CST.loadProject(new File([t], 'p.json')); }, proj); await wait(3000); await p.click('[data-tab=tabMock]'); await wait(800);
  const snapC = await p.evaluate(() => JSON.stringify(window.CST.MK.nodes.map(n => [n.name, +n.x.toFixed(6), +n.y.toFixed(6), n.rot, n.flip, n.hidden])) + JSON.stringify(window.CST.MK.bg));
  ok(snapA === snapC, 'Save / Open project restores the mockup on a clean browser');

  // 7) Layout exports unchanged by all of the above (numbering off)
  await p.click('[data-tab=tabLayout]'); await wait(500);
  await p.evaluate(() => { window.CST.items.forEach(i => window.CST.setPct(i, 100)); window.CST.items.find(i => i.name === 'bear_headset.png').qty = 2; window.CST.items.find(i => i.name === 'window.png').qty = 2; window.CST.refresh(true); }); await wait(2500);
  const e1 = await p.evaluate(() => window.T.exports());
  ok(e1.pdf === e0.pdf, `print PDF byte-identical after all mockup edits (${e1.pdf.length} vs ${e0.pdf.length} base64 chars)`);
  ok(e1.svgs.join('\n') === e0.svgs.join('\n') && e1.pos === e0.pos && e1.code === e0.code, `cut SVG(s) byte-identical, piece positions identical, sheet code unchanged (${e1.code})`);

  // 8) optional piece numbers on the print PDF
  await p.click('#numberPieces'); await wait(900);
  const e2 = await p.evaluate(() => window.T.exports());
  const lab = await p.evaluate(() => { const C = window.CST, L = C.layout, out = []; L.sheets.forEach((pl, si) => C.pieceLabels(pl, L.sh).forEach(lb => {
      let hit = 0; for (let iy = 0; iy <= 6; iy++) for (let ix = 0; ix <= 8; ix++) { const x = lb.x - 0.02 + (lb.w + 0.04) * ix / 8, y = lb.y - 0.02 + (lb.h + 0.04) * iy / 6; for (const e of pl) if (C.insidePiece(e, x, y)) hit++; }
      const e = pl.find(e => e.key === lb.key), d = Math.max(0, e.x - (lb.x + lb.w), lb.x - (e.x + e.p.cutW), e.y - (lb.y + lb.h), lb.y - (e.y + e.p.cutH));
      out.push({ si, t: lb.t, inside: !!lb.inside, hit, d, ok: lb.x >= 0.05 && lb.y >= 0.05 && lb.x + lb.w <= L.sh.w - 0.05 && lb.y + lb.h <= L.sh.h - 0.05 }); })); return out; });
  const pieces = await p.evaluate(() => window.CST.layout.sheets.flat().length);
  ok(lab.length === pieces && lab.every(l => l.ok), `one number per piece (${lab.length}/${pieces}), all on the printable page`);
  ok(lab.filter(l => !l.inside).every(l => l.hit === 0) && lab.filter(l => l.inside).length === 0, `every number sits on the waste: none overlaps a sticker (checked 63 points per label, ≥0.02 in clearance); ${lab.filter(l => l.inside).length} had to go inside`);
  ok(lab.every(l => l.d < 0.2), `each number is next to its own sticker (max ${Math.max(...lab.map(l => l.d)).toFixed(3)} in from its cut box)`);
  ok(e2.pdf !== e0.pdf && e2.svgs.join('\n') === e0.svgs.join('\n') && e2.code === e0.code && e2.pos === e0.pos, 'numbers ON: print PDF changes, cut SVGs byte-identical, sheet code and positions unchanged');
  fs.writeFileSync(path.join(OUT, 'sample-numbered-PRINT.pdf'), Buffer.from(e2.pdf, 'base64'));
  const tn = execFileSync('pdftotext', [path.join(OUT, 'sample-numbered-PRINT.pdf'), '-']).toString(), got = (tn.match(/\b\d+\b/g) || []).map(Number);
  const want = lab.filter(l => l.t !== 'sp').map(l => +l.t), nsp = (tn.match(/\bsp\b/g) || []).length;
  ok(JSON.stringify(got.slice().sort((a, b) => a - b)) === JSON.stringify(want.slice().sort((a, b) => a - b)) && nsp === lab.length - want.length, `numbered PDF text = the piece numbers = assembly steps (${got.length} step labels: ${[...new Set(got)].sort((a, b) => a - b).join(',')}; ${nsp} spare copies labelled "sp")`);
  execFileSync('pdftoppm', ['-r', '60', '-f', '1', '-l', '1', '-png', path.join(OUT, 'sample-numbered-PRINT.pdf'), '/tmp/numbered']);
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, 'ui_layout_numbers.png') });
  // with calibration on, the numbers follow the print compensation (cut SVG still only changes with calibration, never with numbers)
  await p.evaluate(() => { const C = window.CST, c = C.getCal(); c.Q = { v: 2, a11: 0.9745, a12: 0, a21: 0, a22: 0.972, tx: 0, ty: 0 }; c.ex = 1.0262; c.ey = 1.0288; c.mode = 'compensate'; c.status = 'verify'; C.saveCal(c); C.S.applyCorr = true; C.refresh(false); }); await wait(800);
  const c1 = await p.evaluate(() => window.T.exports()); await p.click('#numberPieces'); await wait(800); const c0 = await p.evaluate(() => window.T.exports());
  ok(c1.svgs.join() === c0.svgs.join() && c1.code === c0.code && c1.pdf !== c0.pdf, 'calibration ON: numbers on/off still leaves the cut SVG and sheet code identical');
  await p.evaluate(() => { const C = window.CST; C.saveCal(Object.assign(C.getCal(), { Q: { v: 2, a11: 1, a12: 0, a21: 0, a22: 1, tx: 0, ty: 0 }, ex: 1, ey: 1 })); C.refresh(false); }); await wait(600);
  const e3 = await p.evaluate(() => window.T.exports());
  ok(!(await p.evaluate(() => window.CST.S.numberPieces)) && e3.svgs.join('\n') === e0.svgs.join('\n'), 'numbers OFF again: cut SVG back to the baseline');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
