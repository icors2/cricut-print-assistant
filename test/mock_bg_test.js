// Mockup backdrop image sizing: fit modes (fit / fill / stretch / true size / tile), scale, X/Y offset, drag-to-pan ("Adjust background"),
// 90° turns, opacity, "Backdrop = image size / shape", Reset, Remove; same result in the view, the Mockup PNG, the Guide PNG and the Guide PDF;
// undo, autosave and project round trip; the cut sheet's print PDF / cut SVG never change.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene'), BG = path.join(__dirname, 'samples', 'bg');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
const COL = { R: [255, 0, 0], G: [0, 200, 0], B: [0, 0, 255], Y: [255, 220, 0], M: [255, 0, 255] }; // image quadrants + backdrop colour (magenta)
const near = (px, c, tol) => Math.max(...px.slice(0, 3).map((v, i) => Math.abs(v - c[i]))) <= tol;
const cls = (px) => Object.entries(COL).map(([k, c]) => [k, Math.hypot(...c.map((v, i) => v - px[i]))]).sort((a, b) => a[1] - b[1])[0][0];
const blend = (c, under, a) => c.map((v, i) => Math.round(v * a + under[i] * (1 - a)));
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload();
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction(() => window.CST.items.length === 7, { timeout: 20000 });
  await p.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500);
  const helpers = () => { const C = window.CST;
    window.T = {
      exports: () => { C.computeLayout(); const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD;
        try { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); const u = new Uint8Array(d.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return { pdf: btoa(s), svgs: C.buildSVGs().join('\n'), code: C.stateCode(C.currentState()) }; } finally { window.Date = RD; } },
      img: (u) => new Promise(r => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); r(g); }; im.src = u; }),
      // sample the same backdrop points (inches) in the live view, the Mockup PNG and the Guide PNG
      sample: async (pts) => { C.mkSelect(null); C.renderMock(true); const v = C.mkView, vc = document.querySelector('#mkCanvas').getContext('2d');
        const mp = await window.T.img(C.mockPNG()), gp = await window.T.img(C.guidePNG()), sc = Math.min(150, 5000 / Math.max(C.MK.bg.w, C.MK.bg.h)), px = (g, x, y) => [...g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
        return pts.map(([x, y]) => ({ view: px(vc, v.pad + x * v.sc, v.pad + y * v.sc), png: px(mp, x * sc, y * sc), guide: px(gp, x * sc, y * sc) })); },
      screen: (x, y) => { const c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = C.mkView, k = r.width / c.width; return { x: r.left + (v.pad + x * v.sc) * k, y: r.top + (v.pad + y * v.sc) * k }; },
      bg: () => { const B = Object.assign({}, C.MK.bg); B.img = B.img ? B.img.length : 0; return B; } }; };
  await p.evaluate(helpers);
  const T = (f, ...a) => p.evaluate(f, ...a);
  await p.click('[data-tab=tabMock]'); await wait(800);
  const e0 = await T(() => window.T.exports());
  // pieces hidden for the pixel checks; magenta backdrop to see margins
  await T(() => { const C = window.CST; C.MK.nodes.forEach(n => n.hidden = true); C.MK.bg.color = '#ff00ff'; C.renderMock(true); });
  ok(await T(() => document.querySelector('#mkBgCtl').style.display === 'none'), 'no background image: sizing controls hidden');
  await (await p.$('#mkBgFile')).uploadFile(path.join(BG, 'quadrants_200dpi.png')); await p.waitForFunction(() => window.CST.mkBgRect(), { timeout: 10000 }); await wait(400);
  let bg = await T(() => window.T.bg());
  ok(bg.dpi === 200 && bg.fit === 'fill' && bg.scale === 100 && await T(() => document.querySelector('#mkBgCtl').style.display === ''), `image added: controls shown, dpi read from the file = ${bg.dpi}, default Fill 100%`);
  ok(/1200 × 800 px/.test(await T(() => document.querySelector('#mkBgInfo').textContent)), 'info line: ' + await T(() => document.querySelector('#mkBgInfo').textContent));

  const setUI = async (sel, val) => { await T((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }, sel, String(val)); await wait(150); };
  // check a mode: each [x, y, expectedClass]; view, Mockup PNG and Guide PNG must agree (guide = image at 35% over the backdrop colour)
  const check = async (label, pts, opacity = 1) => { const s = await T((pts) => window.T.sample(pts), pts.map(q => [q[0], q[1]]));
    let good = true, why = [];
    s.forEach((r, i) => { const want = pts[i][2], c = COL[want], vw = want === 'M' ? c : blend(c, COL.M, opacity), gw = want === 'M' ? c : blend(c, COL.M, 0.35 * opacity);
      if (!near(r.png, vw, 4)) { good = false; why.push(`png@${pts[i]} ${r.png.slice(0, 3)}≠${vw}`); }
      if (!near(r.view, vw, 4)) { good = false; why.push(`view@${pts[i]} ${r.view.slice(0, 3)}≠${vw}`); }
      if (!near(r.guide, gw, 4)) { good = false; why.push(`guide@${pts[i]} ${r.guide.slice(0, 3)}≠${gw}`); } });
    ok(good, `${label}: view = Mockup PNG = Guide PNG at ${pts.length} points${why.length ? ' — ' + why.slice(0, 4).join('; ') : ''}`); };
  // Letter portrait 8.5 × 11; image 1200 × 800 px (3:2), 6 × 4 in at 200 dpi
  await setUI('#mkBgFit', 'fit');
  await check('Fit (contain): 8.5 × 5.67 in, centred, magenta margins top/bottom', [[4.25, 1.5, 'M'], [4.25, 9.5, 'M'], [2, 4, 'R'], [6.5, 4, 'G'], [2, 7.5, 'B'], [6.5, 7.5, 'Y'], [0.15, 3, 'R'], [8.35, 8, 'Y']]);
  await setUI('#mkBgFit', 'fill');
  await check('Fill (cover): 16.5 × 11 in, crops the sides, no margins', [[0.2, 0.2, 'R'], [3, 3, 'R'], [5.5, 3, 'G'], [8.3, 0.2, 'G'], [3, 8, 'B'], [8.3, 10.8, 'Y']]);
  await setUI('#mkBgFit', 'stretch');
  await check('Stretch: exactly the page', [[0.2, 0.2, 'R'], [8.3, 0.2, 'G'], [0.2, 10.8, 'B'], [8.3, 10.8, 'Y'], [4.0, 5.3, 'R'], [4.5, 5.7, 'Y']]);
  await setUI('#mkBgFit', 'original');
  await check('True size at 200 dpi: 6 × 4 in, centred (x 1.25–7.25, y 3.5–7.5)', [[1.0, 5, 'M'], [7.5, 5, 'M'], [4.25, 3.3, 'M'], [4.25, 7.7, 'M'], [1.4, 3.65, 'R'], [7.1, 7.35, 'Y']]);
  await setUI('#mkBgFit', 'tile');
  await check('Tile: 6 × 4 in tiles repeating from the centre', [[2, 4, 'R'], [0.5, 4, 'G'], [3.5, 2, 'B'], [0.5, 2, 'Y'], [7.75, 2, 'B'], [0.5, 8, 'G'], [4, 10.5, 'B']]);
  await setUI('#mkBgFit', 'fit'); await setUI('#mkBgScaleN', 50);
  await check('Scale 50% (with Fit): 4.25 × 2.83 in', [[4.25, 3.8, 'M'], [1.8, 5.5, 'M'], [2.3, 4.3, 'R'], [6.1, 6.7, 'Y']]);
  ok(await T(() => document.querySelector('#mkBgScale').value) === '50', 'scale slider follows the typed %');
  await setUI('#mkBgFit', 'original'); await setUI('#mkBgScaleN', 100); await setUI('#mkBgX', 1); await setUI('#mkBgY', -1);
  await check('X +1 / Y −1 in offset (true size): x 2.25–8.25, y 2.5–6.5', [[2.0, 4, 'M'], [2.45, 2.7, 'R'], [8.05, 6.3, 'Y'], [5, 6.8, 'M']]);
  await T(() => document.querySelector('#mkBgCenter').click()); await setUI('#mkBgFit', 'stretch');
  await T(() => document.querySelector('#mkBgRot').click()); await wait(150);
  bg = await T(() => window.T.bg());
  await check(`Turn 90° (stretch): top-left red → top-right (rot ${bg.rot}°)`, [[8.3, 0.2, 'R'], [8.3, 10.8, 'G'], [0.2, 0.2, 'B'], [0.2, 10.8, 'Y']]);
  await setUI('#mkBgOp', 50);
  await check('Opacity 50%: image blended over the backdrop colour', [[8.3, 0.2, 'R'], [0.2, 10.8, 'Y']], 0.5);
  // Guide PDF (ghost mode): page 1 shows the same placement (backdrop white there, image at 35% × opacity)
  await T(() => { const C = window.CST; C.MK.nodes.forEach(n => n.hidden = false); C.MK.guide = 'ghost'; C.renderMock(true); });
  const pdfb = await T(() => { const d = window.CST.guidePDF(), u = new Uint8Array(d.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgt')); fs.writeFileSync(path.join(tmp, 'g.pdf'), Buffer.from(pdfb, 'base64'));
  execFileSync('pdftoppm', ['-r', '20', '-f', '1', '-l', '1', '-png', path.join(tmp, 'g.pdf'), path.join(tmp, 'pg')]);
  const pg = fs.readdirSync(tmp).find(f => f.startsWith('pg'));
  const pdfPx = await T(async (u) => { const g = await window.T.img(u); return [[0.2, 0.2], [8.3, 0.2], [0.2, 10.8], [8.3, 10.8]].map(([x, y]) => [...g.getImageData(Math.floor(x * 20), Math.floor(y * 20), 1, 1).data]); }, 'data:image/png;base64,' + fs.readFileSync(path.join(tmp, pg)).toString('base64'));
  const pw = (c) => blend(c, [255, 255, 255], 0.35 * 0.5), pdfWant = [pw(COL.B), pw(COL.R), pw(COL.Y), pw(COL.G)];
  ok(pdfPx.every((px, i) => near(px, pdfWant[i], 14)), `Guide PDF page 1 (ghost): same turned/stretched background at 35% × 50% opacity — corners ${pdfPx.map(x => x.slice(0, 3).join(',')).join(' | ')}`);
  await T(() => { const C = window.CST; C.MK.guide = 'off'; C.MK.nodes.forEach(n => n.hidden = true); C.renderMock(true); });

  // undo / redo of background settings
  const u0 = await T(() => window.T.bg());
  await setUI('#mkBgFit', 'tile');
  await T(() => window.CST.mkUndo()); await wait(200); let u1 = await T(() => window.T.bg());
  await T(() => window.CST.mkRedo()); await wait(200); let u2 = await T(() => window.T.bg());
  ok(u1.fit === u0.fit && u2.fit === 'tile' && await T(() => document.querySelector('#mkBgFit').value) === 'tile', `undo/redo background fit: tile → ${u1.fit} → ${u2.fit} (panel follows)`);
  await setUI('#mkBgOp', 80); await T(() => window.CST.mkUndo()); await wait(200); u1 = await T(() => window.T.bg());
  ok(Math.abs(u1.opacity - 0.5) < 1e-9 && await T(() => document.querySelector('#mkBgOp').value) === '50', `one slider drag = one undo step (opacity 80% → ${u1.opacity * 100}%)`);
  // Reset
  await T(() => document.querySelector('#mkBgReset').click()); await wait(150); bg = await T(() => window.T.bg());
  ok(bg.fit === 'fill' && bg.scale === 100 && bg.ox === 0 && bg.oy === 0 && bg.rot === 0 && bg.opacity === 1 && bg.dpi === 200, 'Reset: Fill, 100%, centred, not turned, opaque (dpi kept)');

  // drag-to-pan with "Adjust background": pieces stay, background moves
  await T(() => { const C = window.CST; C.MK.nodes.forEach(n => n.hidden = false); C.renderMock(true); }); await wait(200);
  await T(() => document.querySelector('#mkBgFit').value = 'original') ; await setUI('#mkBgFit', 'original');
  const before = await T(() => window.CST.MK.nodes.map(n => [n.x, n.y]));
  await T(() => document.querySelector('#mkBgAdj').click()); await wait(150);
  ok(await T(() => window.CST.mkBgAdj && document.querySelector('#mkBgAdj').classList.contains('on')), 'Adjust background toggle on');
  const sofa = await T(() => { const C = window.CST, n = C.MK.nodes.find(n => C.items.find(i => i.id === n.itemId).name === 'sofa.png'); return [n.x, n.y]; });
  const a = await T((x, y) => window.T.screen(x, y), sofa[0], sofa[1]), z = await T((x, y) => window.T.screen(x, y), sofa[0] + 1.5, sofa[1] - 0.75);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(z.x, z.y, { steps: 10 });
  await p.mouse.up(); await wait(300);
  bg = await T(() => window.T.bg()); const after = await T(() => window.CST.MK.nodes.map(n => [n.x, n.y]));
  ok(Math.abs(bg.ox - 1.5) < 0.03 && Math.abs(bg.oy + 0.75) < 0.03, `dragging over a sticker pans the background instead (offset ${bg.ox.toFixed(3)}, ${bg.oy.toFixed(3)} in)`);
  ok(JSON.stringify(after) === JSON.stringify(before), 'no sticker moved while adjusting the background');
  ok(await T(() => document.querySelector('#mkBgX').value) === String(+bg.ox.toFixed(3)), 'X offset field follows the drag');
  await T(() => window.CST.mkUndo()); await wait(200); bg = await T(() => window.T.bg());
  ok(bg.ox === 0 && bg.oy === 0, 'a background pan is one undo step');
  await p.keyboard.press('Escape'); await wait(100);
  ok(await T(() => !window.CST.mkBgAdj), 'Esc leaves Adjust background; dragging moves stickers again');

  // Backdrop = image size (at dpi) and = image shape (keep width)
  await T(() => document.querySelector('#mkBgToSize').click()); await wait(300); bg = await T(() => window.T.bg());
  ok(bg.w === 6 && bg.h === 4 && bg.preset === 'custom' && bg.fit === 'fill' && bg.scale === 100, `Backdrop = image size: ${bg.w} × ${bg.h} in at 200 dpi, image fills it`);
  await T(() => { const C = window.CST; C.MK.nodes.forEach(n => n.hidden = true); C.renderMock(true); });
  await check('backdrop = image: the whole image, uncropped', [[0.1, 0.1, 'R'], [5.9, 0.1, 'G'], [0.1, 3.9, 'B'], [5.9, 3.9, 'Y']]);
  await setUI('#mkW', 8.5); await setUI('#mkH', 8.5);
  await T(() => document.querySelector('#mkBgAspect').click()); await wait(300); bg = await T(() => window.T.bg());
  ok(bg.w === 8.5 && Math.abs(bg.h - 5.667) < 0.001, `Backdrop = image shape (keep width): ${bg.w} × ${bg.h} in`);
  await T(() => document.querySelector('#mkBgToSize').click()); await wait(300);
  await T(() => { document.querySelector('#mkBgRot').click(); }); await wait(100);
  await T(() => document.querySelector('#mkBgToSize').click()); await wait(300); bg = await T(() => window.T.bg());
  ok(bg.w === 4 && bg.h === 6 && bg.rot === 90, `turned 90° then Backdrop = image size: ${bg.w} × ${bg.h} in`);

  // persistence: autosave (reload) and project round trip keep every background setting
  await T(() => { document.querySelector('#mkPreset').value = 'letter-L'; document.querySelector('#mkPreset').dispatchEvent(new Event('change')); });
  await setUI('#mkBgFit', 'fit'); await setUI('#mkBgScaleN', 80); await setUI('#mkBgX', -0.5); await setUI('#mkBgY', 0.25); await setUI('#mkBgOp', 70); await setUI('#mkBgDpi', 300);
  const want = await T(() => window.T.bg()); await wait(600);
  const key = (B) => JSON.stringify([B.fit, B.scale, B.ox, B.oy, B.rot, B.opacity, B.dpi, B.w, B.h, B.img]);
  const proj = await T(async () => { const o = URL.createObjectURL; let bl; URL.createObjectURL = (x) => { bl = x; return 'data:,'; }; await window.CST.saveProject(); URL.createObjectURL = o; return await bl.text(); });
  const shot0 = await T(async () => { await new Promise(r => setTimeout(r, 300)); return window.CST.mockPNG(); });
  await wait(2200); await p.evaluate(() => localStorage.removeItem('cst.mkAuto')); await p.reload(); await wait(800); await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction(() => window.CST && window.CST.items.length === 7, { timeout: 20000 });
  await p.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await p.evaluate(helpers); await wait(1500);
  await p.click('[data-tab=tabMock]'); await p.waitForFunction(() => window.CST.mkBgRect(), { timeout: 10000 }); await wait(500);
  let got = await T(() => window.T.bg());
  ok(key(got) === key(want), `autosave (reload, images re-added): background settings survive a reload (${got.fit} ${got.scale}% offset ${got.ox},${got.oy} rot ${got.rot} opacity ${got.opacity} ${got.dpi} dpi)`);
  ok(await T(() => document.querySelector('#mkBgFit').value === 'fit' && document.querySelector('#mkBgScaleN').value === '80' && document.querySelector('#mkBgOp').value === '70'), 'panel shows the restored settings');
  const shot1 = await T(() => window.CST.mockPNG());
  ok(shot0 === shot1, 'Mockup PNG identical before and after the reload');
  await T(() => { const B = window.CST.MK.bg; Object.assign(B, { fit: 'tile', scale: 33, ox: 3, oy: 3, rot: 270, opacity: 0.2, dpi: 72 }); window.CST.renderMock(true); });
  await T(async (t) => { await window.CST.loadProject(new File([t], 'p.json')); }, proj); await wait(3000);
  got = await T(() => window.T.bg());
  ok(key(got) === key(want), 'project file round trip keeps the background settings');

  // Remove
  await T(() => document.querySelector('#mkBgClear').click()); await wait(200);
  ok(await T(() => !window.CST.MK.bg.img && document.querySelector('#mkBgCtl').style.display === 'none'), 'Remove: image gone, controls hidden');
  await T(() => window.CST.mkUndo()); await wait(500);
  ok(await T(() => !!window.CST.MK.bg.img), 'Remove can be undone');

  // the cut sheet never changed
  const e9 = await T(() => window.T.exports());
  ok(e9.pdf === e0.pdf && e9.svgs === e0.svgs && e9.code === e0.code, 'all background edits: print PDF and cut SVG byte-identical, sheet code unchanged');

  // screenshot: soft wallpaper tiled behind the scene, controls visible
  await (await p.$('#mkBgFile')).uploadFile(path.join(BG, 'wallpaper_tile_150dpi.png')); await wait(800);
  await T(() => { const C = window.CST; document.querySelector('#mkPreset').value = 'letter-P'; document.querySelector('#mkPreset').dispatchEvent(new Event('change')); C.MK.bg.color = '#fbf3ec'; C.renderMock(true); });
  await setUI('#mkBgFit', 'tile'); await setUI('#mkBgScaleN', 60); await setUI('#mkBgOp', 85); await T(() => { const C = window.CST; C.MK.nodes.forEach(n => n.hidden = false); C.renderMock(true); C.mkSelect(null); C.mkBgAdj = true; }); await wait(400);
  await p.screenshot({ path: path.join(OUT, 'ui_mockup_background.png') });
  await T(() => { window.CST.mkBgAdj = false; }); fs.writeFileSync(path.join(OUT, 'mockup_background_tile.png'), Buffer.from((await T(() => window.CST.mockPNG())).split(',')[1], 'base64'));
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
