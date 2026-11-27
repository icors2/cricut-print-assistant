// Mockup tab: adding images there and resizing them (corner handles locked / Shift-unlocked / link off, typed W/H/%),
// with one shared size per image (Layout <-> Mockup), undo/redo, and the export guarantee:
// move/rotate/flip/layer edits never change the print PDF or cut SVG; size changes do, exactly like the same size typed on the Layout tab.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-features=WebShare', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1000 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload();
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction(() => window.CST.items.length === 7, { timeout: 20000 });
  await p.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500);
  await p.evaluate(() => {
    const C = window.CST;
    window.T = {
      exports: () => { C.computeLayout(); const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD;
        try { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); const u = new Uint8Array(d.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return { pdf: btoa(s), svgs: C.buildSVGs().join('\n'), code: C.stateCode(C.currentState()) }; } finally { window.Date = RD; } },
      it: (nm) => C.items.find(i => i.name === nm),
      node: (nm) => C.MK.nodes.find(n => { const it = C.items.find(i => i.id === n.itemId); return it && it.name === nm; }),
      info: (nm) => { const n = window.T.node(nm), g = C.mkGeom(n), it = window.T.it(nm); return { x: n.x, y: n.y, rot: n.rot, w: g.w, h: g.h, wIn: it.wIn, hIn: it.hIn, lock: it.lockAR, pct: C.pctOf(it) }; },
      screen: (x, y) => { const c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = C.mkView, k = r.width / c.width; return { x: r.left + (v.pad + x * v.sc) * k, y: r.top + (v.pad + y * v.sc) * k }; },
      corner: (nm, sx, sy) => { const n = window.T.node(nm), g = C.mkGeom(n), a = n.rot * Math.PI / 180, lx = sx * g.w / 2, ly = sy * g.h / 2; return { x: n.x + lx * Math.cos(a) - ly * Math.sin(a), y: n.y + lx * Math.sin(a) + ly * Math.cos(a) }; },
      card: (nm) => { const c = [...document.querySelectorAll('#items .item')].find(c => c.querySelector('.iname').textContent === nm); return c && { w: +c.querySelector('[data-f=w] input').value, h: +c.querySelector('[data-f=h] input').value, pct: +c.querySelector('[data-f=pct] input').value }; } };
  });
  const T = (f, ...a) => p.evaluate(f, ...a);
  await p.click('[data-tab=tabMock]'); await wait(800);
  const e0 = await T(() => window.T.exports());

  // 1) mockup-only edits never change exports
  await T(() => { const C = window.CST, n = window.T.node('sofa.png'); n.x += 1.3; n.y -= 0.4; n.rot = 30; n.flip = true; C.mkOrder(window.T.node('rug.png'), 'front'); window.T.node('lamp.png'); C.renderMock(true); }); await wait(300);
  const e1 = await T(() => window.T.exports());
  ok(e1.pdf === e0.pdf && e1.svgs === e0.svgs && e1.code === e0.code, 'move / rotate / flip / layer edits: print PDF and cut SVG byte-identical (frozen clock + fixed PDF ID)');
  await T(() => { const n = window.T.node('sofa.png'); n.rot = 0; n.flip = false; window.CST.renderMock(true); });

  // 2) corner handle, aspect-locked (default): drag the sofa's bottom-right corner outward; top-left corner stays put
  const drag = async (nm, sx, sy, dx, dy, shift, shotName) => { await T((nm) => window.CST.mkSelect(window.T.node(nm)), nm); await wait(200);
    const c = await T((nm, sx, sy) => window.T.corner(nm, sx, sy), nm, sx, sy), a = await T((x, y) => window.T.screen(x, y), c.x, c.y), z = await T((x, y) => window.T.screen(x, y), c.x + dx, c.y + dy);
    await p.mouse.move(a.x, a.y); await p.mouse.down(); if (shift) await p.keyboard.down('Shift'); await p.mouse.move(z.x, z.y, { steps: 12 });
    if (shotName) { await wait(200); await p.screenshot({ path: path.join(OUT, shotName) }); }
    await p.mouse.up(); if (shift) await p.keyboard.up('Shift'); await wait(1800); };
  let s0 = await T(() => window.T.info('sofa.png')), tl0 = await T(() => window.T.corner('sofa.png', -1, -1));
  await drag('sofa.png', 1, 1, 1.0, 0.55, false, 'ui_mockup_resize.png');
  let s1 = await T(() => window.T.info('sofa.png')), tl1 = await T(() => window.T.corner('sofa.png', -1, -1)), card = await T(() => window.T.card('sofa.png'));
  ok(s1.wIn > s0.wIn * 1.2 && Math.abs(s1.hIn / s1.wIn - s0.hIn / s0.wIn) < 1e-9, `locked corner drag: sofa ${s0.wIn.toFixed(3)}×${s0.hIn.toFixed(3)} → ${s1.wIn.toFixed(3)}×${s1.hIn.toFixed(3)} in, ratio kept exactly`);
  ok(Math.hypot(tl1.x - tl0.x, tl1.y - tl0.y) < 0.03, `opposite corner stays put (moved ${Math.hypot(tl1.x - tl0.x, tl1.y - tl0.y).toFixed(4)} in)`);
  ok(Math.abs(card.w - +s1.wIn.toFixed(4)) < 1e-3 && Math.abs(card.h - +s1.hIn.toFixed(4)) < 1e-3, `same size on the Layout card (W ${card.w}, H ${card.h}, ${card.pct}%)`);
  const lay = await T(() => { const e = window.CST.layout.sheets.flat().find(e => e.it.name === 'sofa.png'), g = window.CST.mkGeom(window.T.node('sofa.png')); return { cut: e.rot ? [e.p.cutH, e.p.cutW] : [e.p.cutW, e.p.cutH], mk: [g.w, g.h] }; });
  ok(Math.abs(lay.cut[0] - lay.mk[0]) < 1e-9 && Math.abs(lay.cut[1] - lay.mk[1]) < 1e-9, `cut size on the sheet = size in the mockup (${lay.mk.map(v => v.toFixed(3)).join(' × ')} in)`);
  const e2 = await T(() => window.T.exports());
  ok(e2.svgs !== e0.svgs && e2.pdf !== e0.pdf && e2.code === e0.code, 'a size change made in the Mockup changes the print PDF and cut SVG (intended); sheet code unchanged');
  // equals the same size typed on the Layout tab (fresh page state via undo + Layout input)
  // 3) Shift = unlock while dragging: wall panel (rectangle, no offset) – drag the right edge corner sideways only
  let w0 = await T(() => window.T.info('wall_panel.png'));
  await drag('wall_panel.png', 1, 1, 0.5, 0, true);
  let w1 = await T(() => window.T.info('wall_panel.png'));
  ok(Math.abs(w1.wIn - (w0.wIn + 0.5)) < 0.03 && Math.abs(w1.hIn - w0.hIn) < 0.03 && w1.lock === true, `Shift-drag unlocks: wall ${w0.wIn.toFixed(3)}×${w0.hIn.toFixed(3)} → ${w1.wIn.toFixed(3)}×${w1.hIn.toFixed(3)} (W +0.5, H same), link stays on`);
  // 4) link toggle off in the panel → plain corner drag is free
  await T(() => window.CST.mkSelect(window.T.node('window.png'))); await wait(200); await p.click('#mkSLink'); await wait(1500);
  const wl = await T(() => window.T.info('window.png'));
  await drag('window.png', 1, 1, 0, 0.6, false);
  const wl2 = await T(() => window.T.info('window.png'));
  ok(wl.lock === false && Math.abs(wl2.wIn - wl.wIn) < 0.03 && wl2.hIn > wl.hIn + 0.4, `🔗 off: corner drag changes only H (window ${wl.wIn.toFixed(3)}×${wl.hIn.toFixed(3)} → ${wl2.wIn.toFixed(3)}×${wl2.hIn.toFixed(3)})`);
  ok(await T(() => window.T.card('window.png') && [...document.querySelectorAll('#items .item')].find(c => c.querySelector('.iname').textContent === 'window.png').querySelector('.link').classList.contains('on') === false), 'the Layout card shows the same unlinked state');
  await p.click('#mkSLink'); await wait(1200);

  // 5) typed exact size + % presets in the Selected panel
  await T(() => window.CST.mkSelect(window.T.node('floor_lamp.png'))); await wait(200);
  const l0 = await T(() => window.T.info('floor_lamp.png'));
  await p.click('#mkSW', { clickCount: 3 }); await p.type('#mkSW', '1.25'); await p.keyboard.press('Enter'); await wait(1500);
  const l1 = await T(() => window.T.info('floor_lamp.png')), lc = await T(() => window.T.card('floor_lamp.png'));
  ok(Math.abs(l1.wIn - 1.25) < 1e-12 && Math.abs(l1.hIn / l1.wIn - l0.hIn / l0.wIn) < 1e-9 && Math.abs(lc.w - 1.25) < 1e-9, `typed W 1.25 in (locked) → H ${l1.hIn.toFixed(4)}, Layout card W ${lc.w} H ${lc.h}`);
  await p.click('#mkSH', { clickCount: 3 }); await p.type('#mkSH', '3'); await p.keyboard.press('Enter'); await wait(1500);
  const l2 = await T(() => window.T.info('floor_lamp.png')); ok(Math.abs(l2.hIn - 3) < 1e-12 && Math.abs(l2.wIn / l2.hIn - l0.wIn / l0.hIn) < 1e-9, `typed H 3 in → W ${l2.wIn.toFixed(4)}`);
  await T(() => [...document.querySelectorAll('#mkSelPanel .pp')].find(b => b.dataset.p === '50').click()); await wait(1500);
  const l3 = await T(() => window.T.info('floor_lamp.png')); ok(Math.abs(l3.pct - 50) < 1e-9 && Math.abs(await T(() => +document.querySelector('#mkSPct').value) - 50) < 1e-9, `50% preset → ${l3.wIn.toFixed(4)} × ${l3.hIn.toFixed(4)} in`);
  const note = await T(() => document.querySelector('#mkSizeNote').textContent); ok(/applies to every copy/.test(note) && /cut sheet/.test(note), 'panel says the size applies to all copies and the cut sheet: ' + note);

  // 6) undo / redo of a mockup resize (sizes come back on both tabs)
  await p.focus('#mkCanvas'); await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await wait(1500);
  const u1 = await T(() => window.T.info('floor_lamp.png')), uc = await T(() => window.T.card('floor_lamp.png'));
  ok(Math.abs(u1.hIn - 3) < 1e-12 && Math.abs(uc.h - 3) < 1e-9, `Ctrl+Z undoes the 50% preset (lamp H back to ${u1.hIn}, Layout card too)`);
  await p.click('#mkRedo'); await wait(1500); ok(Math.abs((await T(() => window.T.info('floor_lamp.png'))).pct - 50) < 1e-9, 'Redo re-applies it');

  // 7) Layout → Mockup: a size typed on the Layout tab shows up, and Mockup undo doesn't revert it
  await p.click('[data-tab=tabLayout]'); await wait(400);
  const bc = await p.evaluateHandle(() => [...document.querySelectorAll('#items .item')].find(c => c.querySelector('.iname').textContent === 'bear_headset.png'));
  const bw = await bc.$('[data-f=w] input'); await bw.click({ clickCount: 3 }); await bw.type('1'); await bw.evaluate(e => e.dispatchEvent(new Event('change'))); await wait(1500);
  await p.click('[data-tab=tabMock]'); await wait(600); await T(() => window.CST.mkSelect(window.T.node('bear_headset.png'))); await wait(200);
  const bi = await T(() => window.T.info('bear_headset.png')), pw = await T(() => +document.querySelector('#mkSW').value);
  ok(Math.abs(bi.wIn - 1) < 1e-12 && Math.abs(pw - 1) < 1e-9, `Layout W 1 in → mockup bear W ${bi.wIn} (panel shows ${pw}), drawn ${bi.w.toFixed(3)} in cut width`);
  await T(() => { const n = window.T.node('rug.png'); n.x += 0.5; window.CST.renderMock(true); }); await T(() => window.CST.mkSetSize && 0);
  await T(() => { window.CST.mkSelect(window.T.node('rug.png')); }); await p.focus('#mkCanvas'); await p.keyboard.press('ArrowRight'); await wait(300);
  await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control'); await wait(1200);
  ok(Math.abs((await T(() => window.T.info('bear_headset.png'))).wIn - 1) < 1e-12, 'Mockup undo of a later move leaves the Layout-made bear size alone');

  // 8) add an image directly in the Mockup
  const n0 = await T(() => window.CST.items.length);
  await (await p.$('#mkFile')).uploadFile(path.join(__dirname, 'samples', 'star_sticker.png')); await p.waitForFunction((n) => window.CST.items.length === n + 1, { timeout: 15000 }, n0); await wait(1500);
  const added = await T(() => { const C = window.CST, it = C.items[C.items.length - 1], n = C.MK.nodes.find(n => n.itemId === it.id); return { name: it.name, qty: it.qty, shape: it.shape, node: !!n, sel: C.mkSel && C.mkSel.itemId === it.id, onSheet: C.layout.sheets.flat().some(e => e.it === it), card: [...document.querySelectorAll('#items .item .iname')].some(e => e.textContent === it.name), row: [...document.querySelectorAll('#mkAdd .lname')].some(e => e.textContent.startsWith(it.name)) }; });
  ok(added.name === 'star_sticker.png' && added.qty === 1 && added.shape === 'contour' && added.node && added.sel && added.onSheet && added.card && added.row, 'file added in the Mockup: joins the shared list (qty 1, contour cut), on the cut sheet and Layout cards, placed and selected in the mockup ' + JSON.stringify(added));
  await T(() => window.CST.mkSelect(window.T.node('star_sticker.png'))); await wait(200);
  await p.click('#mkSW', { clickCount: 3 }); await p.type('#mkSW', '1.5'); await p.keyboard.press('Enter'); await wait(1500);
  ok(Math.abs((await T(() => window.T.card('star_sticker.png'))).w - 1.5) < 1e-9, 'resizing the new image in the Mockup updates its Layout card');

  // 9) the mockup size equals what the Layout tab would make from the same numbers (one source of truth)
  const same = await T(() => { const C = window.CST, a = window.T.exports(), it = window.T.it('sofa.png'), w = it.wIn, h = it.hIn; it.wIn = w + 0; it.hIn = h + 0; C.cache.clear(); const b2 = window.T.exports(); return a.svgs === b2.svgs && a.pdf === b2.pdf; });
  ok(same, 'exports after Mockup resizes are reproducible from the stored sizes (cache cleared → byte-identical)');

  // 10) project round trip keeps the new sizes + mockup
  const want = await T(() => JSON.stringify(window.CST.items.map(i => [i.name, +i.wIn.toFixed(9), +i.hIn.toFixed(9), i.lockAR !== false])));
  const proj = await T(async () => { const o = URL.createObjectURL; let bl; URL.createObjectURL = (x) => { bl = x; return 'data:,'; }; await window.CST.saveProject(); URL.createObjectURL = o; return await bl.text(); });
  await T(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload(); await wait(800);
  await T(async (t) => { await window.CST.loadProject(new File([t], 'p.json')); }, proj); await wait(3000);
  ok(want === await T(() => JSON.stringify(window.CST.items.map(i => [i.name, +i.wIn.toFixed(9), +i.hIn.toFixed(9), i.lockAR !== false]))), 'Save / Open project keeps every size set in the Mockup');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
