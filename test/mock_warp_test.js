// Mockup Transform (skew / free distort): preview only. The warped image + outline render where the warp puts them (view, Mockup PNG, Guide PNG,
// Guide PDF vector outline), handles drag corners (distort) and side middles (skew), numeric skew, Reset, undo/redo, saves (autosave, file, project);
// the cut size, the Layout's print PDF / cut SVG / sheet code and Send to Layout are unaffected.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
const HELP = () => { const C = window.CST; window.T = {
  b64: (doc) => { const u = new Uint8Array(doc.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  frozen: (f) => { const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD; try { return f(); } finally { window.Date = RD; } },
  exports: () => { C.computeLayout(); return window.T.frozen(() => { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); return { pdf: window.T.b64(d), svgs: C.buildSVGs().join('\n'), code: C.stateCode(C.currentState()), sizes: JSON.stringify(C.items.map(i => [i.name, i.wIn, i.hIn, i.qty])) }; }); },
  name: (n) => { const it = C.items.find(i => i.id === n.itemId); return it ? it.name : n.name; },
  node: (nm) => C.MK.nodes.find(n => window.T.name(n) === nm),
  img: (u) => new Promise(r => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); r(g); }; im.src = u; }),
  // world point (backdrop in) of a box point of node n, with or without its warp
  world: (n, bx, by, warped) => { const G = C.mkGeom(n), it = C.items.find(i => i.id === n.itemId); let x = bx * G.w, y = by * G.h; if (warped) { const M = C.warpMap(n, Object.assign({}, G, { p: null })); [x, y] = M.f(x, y); }
    let lx = x - G.w / 2; const ly = y - G.h / 2; if (n.flip) lx = -lx; const c = Math.cos(n.rot * Math.PI / 180), s = Math.sin(n.rot * Math.PI / 180); return [n.x + lx * c - ly * s, n.y + lx * s + ly * c]; },
  screen: (x, y) => { const c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = C.mkView, k = r.width / c.width; return [r.left + (v.pad + x * v.sc) * k, r.top + (v.pad + y * v.sc) * k]; } }; };
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  const T = (f, ...a) => p.evaluate(f, ...a);
  await p.goto('file://' + R + '/index.html'); await T(async () => { localStorage.clear(); sessionStorage.clear(); window.name = ''; await new Promise(r => { const q = indexedDB.deleteDatabase('cst-mockups'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); }); await p.reload();
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction((n) => window.CST.items.length === n, { timeout: 20000 }, FILES.length);
  await T(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500); await p.evaluate(HELP);
  const base = await T(() => window.T.exports());
  await p.click('[data-tab=tabMock]'); await wait(800);
  // isolate the floor boards (opaque 6 × 1 in strip) on a pure blue backdrop so the warped shape can be measured in pixels
  await T(() => { const C = window.CST, T = window.T; C.MK.bg.color = '#0000ff'; C.MK.nodes.forEach(n => { n.hidden = T.name(n) !== 'floor_boards.png'; }); const n = T.node('floor_boards.png'); n.x = 4.25; n.y = 5.5; n.rot = 0; C.renderMock(true); C.mkSelect(n); });
  await wait(300);
  const plan0 = await T(() => JSON.stringify(window.CST.mkSendPlan(true).keep.map(r => [r.it.name, r.k, r.it.wIn, r.it.hIn])));

  // 1) free distort with the mouse: Transform mode, drag the top-right corner 0.5 in right and 0.6 in up
  await p.click('#mkXf'); await wait(200);
  ok(await T(() => window.CST.mkXf && getComputedStyle(document.querySelector('#mkWarpNote')).display !== 'none' && /preview-only; the sticker prints undistorted/.test(document.querySelector('#mkWarpNote').textContent)), 'Transform mode on, note: "Warp is preview-only; the sticker prints undistorted."');
  const hd = await T(() => { const C = window.CST, n = window.T.node('floor_boards.png'), H = C.mkWarpHandles(n, Object.assign({}, C.mkGeom(n))); return H.map(([x, y]) => window.T.screen(x, y)).concat([window.T.screen(H[1][0] + 0.5, H[1][1] - 0.6)]); });
  await p.mouse.move(...hd[1]); await p.mouse.down(); await p.mouse.move(...hd[8], { steps: 10 }); await p.mouse.up(); await wait(400);
  const w1 = await T(() => window.T.node('floor_boards.png').warp);
  ok(w1 && Math.abs(w1.q[1][0] - 0.5) < 0.03 && Math.abs(w1.q[1][1] + 0.6) < 0.03 && w1.q[0][0] === 0 && w1.q[2][0] === 0, `corner drag = free distort of that corner only (TR offset ${w1 && w1.q[1].map(v => v.toFixed(3)).join(', ')} in)`);
  // pixels: points inside the warped quad but outside the original strip are drawn (boards colour), the original top-right corner area is now partly outside
  const px = async (which) => T(async (which) => { const C = window.CST, T = window.T, n = T.node('floor_boards.png'), src = which === 'png' ? await T.img(C.mockPNG()) : document.querySelector('#mkCanvas').getContext('2d');
    const sc = which === 'png' ? Math.min(150, 5000 / Math.max(C.MK.bg.w, C.MK.bg.h)) : C.mkView.sc, pad = which === 'png' ? 0 : C.mkView.pad;
    const at = (x, y) => [...src.getImageData(Math.round(pad + x * sc), Math.round(pad + y * sc), 1, 1).data]; const blue = (c) => c[2] > 200 && c[0] < 60 && c[1] < 60;
    const inW = [[0.95, 0.08], [0.9, 0.5], [0.5, 0.5], [0.97, 0.9], [0.05, 0.1]].map(([u, v]) => at(...T.world(n, u, v, true))), outOrig = [[0.97, 0.05]].map(([u, v]) => T.world(n, u, v, true));
    const above = at(4.25 + 2.9, 5.5 - 0.5 - 0.35); // above the original strip's right end: inside the warped quad
    return { inside: inW.every(c => !blue(c)), above: !blue(above), sample: inW[0] }; }, which);
  const v1 = await px('view'), m1 = await px('png');
  ok(v1.inside && v1.above, 'view: the image fills the warped quad (incl. the area above the original strip)');
  ok(m1.inside && m1.above, 'Mockup PNG: same warped shape');
  // 2) skew with a side handle (top middle, 0.4 in to the left)
  const hd2 = await T(() => { const C = window.CST, n = window.T.node('floor_boards.png'), H = C.mkWarpHandles(n, C.mkGeom(n)); return [window.T.screen(...H[4]), window.T.screen(H[4][0] - 0.4, H[4][1])]; });
  await p.mouse.move(...hd2[0]); await p.mouse.down(); await p.mouse.move(...hd2[1], { steps: 8 }); await p.mouse.up(); await wait(300);
  const w2 = await T(() => window.T.node('floor_boards.png').warp);
  ok(w2.sx > 36 && w2.sx < 41 && Math.abs(w2.q[1][0] - w1.q[1][0]) < 1e-9, `top-middle handle skews X (${w2.sx}°: tan = 0.4 / 0.5 in), the corner offset is kept`);
  ok(Math.abs(await T(() => +document.querySelector('#mkSkX').value) - w2.sx) < 0.06, 'Skew X° box shows it');
  // numeric skew Y
  await T(() => { const e = document.querySelector('#mkSkY'); e.value = '6'; e.dispatchEvent(new Event('change')); }); await wait(300);
  ok(await T(() => window.T.node('floor_boards.png').warp.sy) === 6, 'typed Skew Y° = 6');
  // 3) guide outline follows the warp: Guide PDF vector path and Guide PNG pixels
  await p.select('#mkGuide', 'outline'); await wait(300);
  const pdfOut = await T(() => { const C = window.CST, J = window.jspdf, RJ = J.jsPDF, segs = [];
    window.jspdf = Object.assign({}, J, { jsPDF: function (...a) { const d = new RJ(...a), o = d.lines; d.lines = function (dd, x, y) { const pts = [[x, y]]; for (const [dx, dy] of dd) pts.push([pts[pts.length - 1][0] + dx, pts[pts.length - 1][1] + dy]); segs.push(pts); return o.apply(d, arguments); }; return d; } });
    try { C.guidePDF(); } finally { window.jspdf = J; } const n = window.T.node('floor_boards.png'), q = C.warpQuad(n, C.mkGeom(n)).map(([x, y]) => window.T.world(n, x / C.mkGeom(n).w, y / C.mkGeom(n).h, false));
    const all = segs.flat(), bb = (P) => [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))];
    return { got: bb(all).map(v => v / 72), want: bb(q) }; });
  ok(pdfOut.got.every((v, i) => Math.abs(v - pdfOut.want[i]) < 0.01), `Guide PDF outline = the warped quad (bbox ${pdfOut.got.map(v => v.toFixed(3)).join(', ')} in vs ${pdfOut.want.map(v => v.toFixed(3)).join(', ')})`);
  const gp = await T(async () => { const C = window.CST, T = window.T, n = T.node('floor_boards.png'), g = await T.img(C.guidePNG()), sc = Math.min(150, 5000 / Math.max(C.MK.bg.w, C.MK.bg.h));
    const dark = (x, y) => { const d = g.getImageData(Math.round(x * sc) - 3, Math.round(y * sc) - 3, 7, 7).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 110) return true; return false; };
    let warped = 0, orig = 0; for (let k = 1; k < 10; k++) { const v = k / 10; if (dark(...T.world(n, 1, v, true))) warped++; if (dark(...T.world(n, 1, v, false))) orig++; } return { warped, orig }; });
  ok(gp.warped >= 7 && gp.orig <= 2, `Guide PNG: dashed outline on the warped right edge (${gp.warped}/9 samples), not on the original one (${gp.orig}/9)`);
  await p.select('#mkGuide', 'off'); await wait(200);
  await T(() => { window.scrollTo(0, 0); }); await p.screenshot({ path: path.join(OUT, 'ui_mockup_transform.png') });
  // 4) preview only: Layout exports, sizes, Send-to-Layout plan unchanged
  const e1 = await T(() => window.T.exports());
  ok(e1.pdf === base.pdf && e1.svgs === base.svgs && e1.code === base.code && e1.sizes === base.sizes, `warp leaves the print PDF, cut SVG, sizes and sheet code (${e1.code}) byte-identical`);
  ok(await T(() => JSON.stringify(window.CST.mkSendPlan(true).keep.map(r => [r.it.name, r.k, r.it.wIn, r.it.hIn]))) === plan0, 'Send to Layout plan ignores the warp');
  // 5) undo / redo / reset
  await T(() => window.CST.mkUndo()); await wait(200);
  ok(await T(() => window.T.node('floor_boards.png').warp.sy === 0), 'undo removes the typed skew Y');
  await T(() => window.CST.mkRedo()); await wait(200); ok(await T(() => window.T.node('floor_boards.png').warp.sy === 6), 'redo brings it back');
  const wFull = await T(() => JSON.stringify(window.T.node('floor_boards.png').warp));
  // 6) saves: autosave with images survives a reload; mockup file carries the warp
  await wait(2200); await T(() => window.CST.mkSetXf(false)); await p.reload(); await p.waitForFunction(() => window.CST && window.CST.items.length === 7, { timeout: 20000 }); await wait(2500); await p.evaluate(HELP);
  ok(await T(() => JSON.stringify(window.T.node('floor_boards.png').warp)) === wFull, 'autosave: the warp survives a reload');
  const file = await T(async () => { const o = URL.createObjectURL; let bl; URL.createObjectURL = (x) => { bl = x; return o.call(URL, x); }; try { window.CST.mkSaveFile(); } finally { URL.createObjectURL = o; } return await bl.text(); });
  ok(JSON.stringify(JSON.parse(file).mockup.nodes.find(n => n.name === 'floor_boards.png').warp) === wFull, 'mockup / project file stores the warp');
  await p.click('[data-tab=tabMock]'); await wait(600);
  await T(() => { const C = window.CST; C.mkSelect(window.T.node('floor_boards.png')); }); await wait(200);
  await p.click('#mkXfReset'); await wait(300);
  ok(await T(() => !window.CST.isWarped(window.T.node('floor_boards.png')) && getComputedStyle(document.querySelector('#mkWarpNote')).display === 'none'), 'Reset transform clears it (note hidden)');
  await T(() => window.CST.mkUndo()); await wait(200); ok(await T(() => JSON.stringify(window.T.node('floor_boards.png').warp)) === wFull, 'reset can be undone');
  // Ctrl + corner drag works without Transform mode
  const hd3 = await T(() => { const C = window.CST, n = window.T.node('floor_boards.png'), H = C.mkWarpHandles(n, C.mkGeom(n)); return [window.T.screen(...H[3]), window.T.screen(H[3][0] - 0.3, H[3][1] + 0.2)]; });
  await p.keyboard.down('Control'); await p.mouse.move(...hd3[0]); await p.mouse.down(); await p.mouse.move(...hd3[1], { steps: 6 }); await p.mouse.up(); await p.keyboard.up('Control'); await wait(300);
  const w3 = await T(() => window.T.node('floor_boards.png').warp);
  ok(!(await T(() => window.CST.mkXf)) && Math.abs(w3.q[3][0] + 0.3) < 0.05 && Math.abs(w3.q[3][1] - 0.2) < 0.05, `Ctrl + drag a corner distorts without Transform mode (BL ${w3.q[3].map(v => v.toFixed(3)).join(', ')})`);
  const e2 = await T(() => window.T.exports());
  ok(e2.pdf === base.pdf && e2.svgs === base.svgs && e2.code === base.code, 'still byte-identical Layout exports');
  await T(() => window.CST.mkSelect(null)); await wait(200);
  ok(await T(() => getComputedStyle(document.querySelector('#mkWarpNote')).display === 'none'), 'nothing selected: the preview-only note is hidden');
  // the plain localStorage autosave (no IndexedDB copy) also restores a warped mockup at startup
  await wait(2200); await T(() => localStorage.removeItem('cst.mkAuto')); await p.reload(); await wait(1500);
  const lsN = await T(() => { const n = window.CST.MK.nodes.find(n => n.name === 'floor_boards.png'); return { len: window.CST.MK.nodes.length, w: n && n.warp }; });
  ok(lsN.len === 7 && JSON.stringify(lsN.w) === JSON.stringify(w3), `startup load of the saved mockup keeps all pieces and the warp (${lsN.len} pieces)`);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
