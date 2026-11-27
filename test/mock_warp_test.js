// Mockup Transform (skew / free distort), baked into the printed sticker. The warped image + outline render where the warp puts them (view, Mockup PNG,
// Guide PNG, Guide PDF vector outline); handles drag corners (distort) and side middles (skew); numeric skew, Reset, undo/redo, saves (autosave, file, project).
// The image's print raster and cut path are warped with the same mapping and line up (processed alpha vs contour, and the real PDF vs the cut SVG).
// Unwarped exports stay byte-identical, the sheet code is unchanged, and Send to Layout splits copies with different warps into their own entries.
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
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-features=WebShare', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  const T = (f, ...a) => p.evaluate(f, ...a);
  await p.goto('file://' + R + '/index.html'); await T(async () => { localStorage.clear(); sessionStorage.clear(); window.name = ''; await new Promise(r => { const q = indexedDB.deleteDatabase('cst-mockups'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); }); await p.reload();
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction((n) => window.CST.items.length === n, { timeout: 20000 }, FILES.length);
  await T(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500); await p.evaluate(HELP);
  const base = await T(() => window.T.exports());
  // fingerprint of every other image's print raster + cut loops (must not change when the floor boards are warped)
  const fp = () => T(() => { const C = window.CST, h = (t) => { let x = 2166136261; for (let i = 0; i < t.length; i++) x = Math.imul(x ^ t.charCodeAt(i), 16777619); return (x >>> 0).toString(16); };
    return C.items.filter(i => i.name !== 'floor_boards.png').map(i => { const q = C.processed(i, false); return i.name + ':' + h(q.print.canvas.toDataURL()) + ':' + h(JSON.stringify(q.loops)); }).join(' '); });
  const fp0 = await fp();
  await p.click('[data-tab=tabMock]'); await wait(800);
  // isolate the floor boards (opaque 6 × 1 in strip) on a pure blue backdrop so the warped shape can be measured in pixels
  await T(() => { const C = window.CST, T = window.T; C.MK.bg.color = '#0000ff'; C.MK.nodes.forEach(n => { n.hidden = T.name(n) !== 'floor_boards.png'; }); const n = T.node('floor_boards.png'); n.x = 4.25; n.y = 5.5; n.rot = 0; C.renderMock(true); C.mkSelect(n); });
  await wait(300);
  const plan0 = await T(() => JSON.stringify(window.CST.mkSendPlan(true).keep.map(r => [r.it.name, r.k, r.it.wIn, r.it.hIn])));

  // 1) free distort with the mouse: Transform mode, drag the top-right corner 0.5 in right and 0.6 in up
  await p.click('#mkXf'); await wait(200);
  ok(await T(() => window.CST.mkXf && getComputedStyle(document.querySelector('#mkWarpNote')).display !== 'none' && /^Warp applies to the printed sticker\./.test(document.querySelector('#mkWarpNote').textContent)), 'Transform mode on, note: "Warp applies to the printed sticker."');
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
  // 4) the warp is baked into the printed sticker: the image takes the piece's warp live, its cut size becomes the warped bbox
  const sz = await T(() => { const C = window.CST, n = window.T.node('floor_boards.png'), it = C.items.find(i => i.id === n.itemId), G = C.mkGeom(n), P = C.warpQuad(n, G), q = C.processed(it, false), bw = (k) => Math.max(...P.map(p => p[k])) - Math.min(...P.map(p => p[k]));
    return { same: JSON.stringify(it.warp) === JSON.stringify(n.warp), cut: [q.cutW, q.cutH], quad: [bw(0), bw(1)], base: [G.w, G.h] }; });
  ok(sz.same && Math.abs(sz.cut[0] - sz.quad[0]) < 1e-6 && Math.abs(sz.cut[1] - sz.quad[1]) < 1e-6, `Layout image = the piece's warp; cut size ${sz.cut.map(v => v.toFixed(3)).join(' × ')} in = warped bbox (was ${sz.base.map(v => v.toFixed(3)).join(' × ')})`);
  const e1 = await T(() => window.T.exports());
  ok(e1.pdf !== base.pdf && e1.svgs !== base.svgs && e1.code === base.code && e1.sizes === base.sizes, `print PDF and cut SVG carry the warp; sheet code (${e1.code}) and image sizes unchanged`);
  ok(await fp() === fp0, 'every other (unwarped) image: print raster and cut path byte-identical');
  ok(await T(() => JSON.stringify(window.CST.mkSendPlan(true).keep.map(r => [r.it.name, r.k, r.it.wIn, r.it.hIn]))) === plan0 && await T(() => window.CST.mkSendPlan(true).splits.length === 0), 'Send to Layout plan: same entries, no split (one copy)');
  // print raster vs cut path, at the processing level: alpha edge of the warped print vs the warped cut loops (bleed 0 → they must coincide; with bleed → the print covers the cut)
  const align = (name, bleed0) => T((name, bleed0) => { const C = window.CST, it = C.items.find(i => i.name === name), keep = C.S.bleed; if (bleed0) { C.S.bleed = 0; C.cache.clear(); }
    try { const q = C.processed(it, false), pr = q.print, W = pr.canvas.width, H = pr.canvas.height, k = W / pr.w, a = pr.canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.setTransform(k, 0, 0, k, -pr.x * k, -pr.y * k); const P = new Path2D(); let per = 0, lx = 0, ly = 0, mx = 0, my = 0;
      for (const l of q.loops) for (const sg of l) { if (sg[0] === 'M') { P.moveTo(sg[1], sg[2]); lx = mx = sg[1]; ly = my = sg[2]; } else if (sg[0] === 'L') { P.lineTo(sg[1], sg[2]); per += Math.hypot(sg[1] - lx, sg[2] - ly); lx = sg[1]; ly = sg[2]; } else { P.closePath(); per += Math.hypot(mx - lx, my - ly); } }
      g.fillStyle = '#000'; g.fill(P); const b = g.getImageData(0, 0, W, H).data; let both = 0, ao = 0, bo = 0;
      for (let i = 3; i < a.length; i += 4) { const A = a[i] >= 128, B = b[i] >= 128; if (A && B) both++; else if (A) ao++; else if (B) bo++; }
      return { iou: both / (both + ao + bo), mis: (ao + bo) / (per * k), cutOut: bo / (both + bo), warped: !!q.warped, px: [W, H] }; } finally { if (bleed0) { C.S.bleed = keep; C.cache.clear(); } } }, name, bleed0);
  const al0 = await align('floor_boards.png', true), al1 = await align('floor_boards.png', false);
  ok(al0.warped && al0.iou > 0.98 && al0.mis < 0.75, `warped print raster vs warped cut path (bleed 0): IoU ${al0.iou.toFixed(4)}, mean edge offset ${al0.mis.toFixed(2)} px at 300 dpi (${al0.px.join('×')} px)`);
  ok(al1.cutOut < 0.001, `with bleed the warped print covers the whole warped cut (${(al1.cutOut * 100).toFixed(3)}% of the cut uncovered)`);
  // a contour-cut piece (transparent PNG): warp the bear, compare its alpha edge with its warped contour
  const bearShape = await T(() => { const C = window.CST, n = window.T.node('bear_headset.png'), it = C.items.find(i => i.id === n.itemId); n.warp = { sx: 12, sy: -5, q: [[0.2, 0], [0, 0.15], [-0.1, 0], [0, 0]] }; C.syncItemWarps(); return it.shape; });
  const al2 = await align('bear_headset.png', true);
  ok(bearShape === 'contour' && al2.warped && al2.iou > 0.97 && al2.mis < 0.75, `contour piece: warped alpha edge vs warped contour (bleed 0): IoU ${al2.iou.toFixed(4)}, mean edge offset ${al2.mis.toFixed(2)} px`);
  await T(() => { const C = window.CST; window.T.node('bear_headset.png').warp = null; C.syncItemWarps(); C.refresh(true); }); await wait(600);
  // end to end: the real print PDF (rendered by pdftoppm) vs the real cut SVG path, around the warped floor boards (bleed 0, so the colour edge is the cut edge)
  const ex = await T(() => { const C = window.CST, keep = C.S.bleed; C.S.bleed = 0; C.cache.clear();
    try { const L = C.computeLayout(); let si = -1, e = null; L.sheets.forEach((l, i) => l.forEach(x => { if (x.it.name === 'floor_boards.png') { si = i; e = x; } }));
      const d = C.buildPDF(); return { si, rect: [e.x, e.y, e.p.cutW, e.p.cutH], per: (() => { let t = 0; for (const l of e.p.loops) { let lx, ly, mx, my; for (const s of l) { if (s[0] === 'M') { lx = mx = s[1]; ly = my = s[2]; } else if (s[0] === 'L') { t += Math.hypot(s[1] - lx, s[2] - ly); lx = s[1]; ly = s[2]; } else t += Math.hypot(mx - lx, my - ly); } } return t; })(),
        pdf: window.T.b64(d), svg: C.buildSVGs()[si], inset: C.S.inset }; } finally { C.S.bleed = keep; C.cache.clear(); C.computeLayout(); } });
  fs.writeFileSync('/tmp/warp_e2e.pdf', Buffer.from(ex.pdf, 'base64'));
  execFileSync('pdftoppm', ['-r', '150', '-f', String(ex.si + 1), '-l', String(ex.si + 1), '-png', '-singlefile', '/tmp/warp_e2e.pdf', '/tmp/warp_e2e']);
  const e2e = await T(async (png, ex) => { const g0 = await window.T.img(png), W = g0.canvas.width, H = g0.canvas.height, D = 150, m = 0.03;
    const x0 = Math.floor((ex.rect[0] - m) * D), y0 = Math.floor((ex.rect[1] - m) * D), x1 = Math.ceil((ex.rect[0] + ex.rect[2] + m) * D), y1 = Math.ceil((ex.rect[1] + ex.rect[3] + m) * D);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), d = /id="cuts"[^>]* d="([^"]+)"/.exec(ex.svg)[1];
    g.setTransform(D / 72, 0, 0, D / 72, ex.inset * D, ex.inset * D); g.fill(new Path2D(d));
    const a = g0.getImageData(x0, y0, x1 - x0, y1 - y0).data, b = g.getImageData(x0, y0, x1 - x0, y1 - y0).data; let both = 0, ao = 0, bo = 0;
    for (let i = 0; i < a.length; i += 4) { const A = a[i] + a[i + 1] + a[i + 2] < 720, B = b[i + 3] >= 128; if (A && B) both++; else if (A) ao++; else if (B) bo++; }
    return { iou: both / (both + ao + bo), mis: (ao + bo) / (ex.per * D) }; }, 'data:image/png;base64,' + fs.readFileSync('/tmp/warp_e2e.png').toString('base64'), ex);
  ok(e2e.iou > 0.97 && e2e.mis < 1.0, `exported print PDF (150 dpi render) vs exported cut SVG path around the warped piece: IoU ${e2e.iou.toFixed(4)}, mean edge offset ${e2e.mis.toFixed(2)} px`);
  // 5) undo / redo / reset
  await T(() => window.CST.mkUndo()); await wait(200);
  ok(await T(() => { const n = window.T.node('floor_boards.png'), it = window.CST.items.find(i => i.id === n.itemId); return n.warp.sy === 0 && it.warp.sy === 0; }), 'undo removes the typed skew Y (piece and printed image)');
  await T(() => window.CST.mkRedo()); await wait(200); ok(await T(() => { const n = window.T.node('floor_boards.png'), it = window.CST.items.find(i => i.id === n.itemId); return n.warp.sy === 6 && it.warp.sy === 6; }), 'redo brings it back (piece and printed image)');
  await wait(400); const eR = await T(() => window.T.exports()); ok(eR.pdf === e1.pdf && eR.svgs === e1.svgs, 'after undo + redo the exports are byte-identical to before');
  const wFull = await T(() => JSON.stringify(window.T.node('floor_boards.png').warp));
  // 6) saves: autosave with images survives a reload; mockup file carries the warp
  await wait(2200); await T(() => window.CST.mkSetXf(false)); await p.reload(); await p.waitForFunction(() => window.CST && window.CST.items.length === 7, { timeout: 20000 }); await wait(2500); await p.evaluate(HELP);
  ok(await T(() => JSON.stringify(window.T.node('floor_boards.png').warp)) === wFull, 'autosave: the warp survives a reload');
  const file = await T(async () => { const o = URL.createObjectURL; let bl; URL.createObjectURL = (x) => { bl = x; return o.call(URL, x); }; try { window.CST.mkSaveFile(); } finally { URL.createObjectURL = o; } return await bl.text(); });
  ok(JSON.stringify(JSON.parse(file).mockup.nodes.find(n => n.name === 'floor_boards.png').warp) === wFull && JSON.stringify(JSON.parse(file).items.find(i => i.name === 'floor_boards.png').warp) === wFull && !JSON.parse(file).items.find(i => i.name === 'sofa.png').warp, 'mockup / project file stores the warp (piece and image; unwarped images have none)');
  await p.click('[data-tab=tabMock]'); await wait(600);
  await T(() => { const C = window.CST; C.mkSelect(window.T.node('floor_boards.png')); }); await wait(200);
  await p.click('#mkXfReset'); await wait(300);
  ok(await T(() => !window.CST.isWarped(window.T.node('floor_boards.png')) && getComputedStyle(document.querySelector('#mkWarpNote')).display === 'none'), 'Reset transform clears it (note hidden)');
  await wait(400); const e0 = await T(() => window.T.exports());
  ok(e0.pdf === base.pdf && e0.svgs === base.svgs && e0.code === base.code, 'unwarped again: print PDF, cut SVG and sheet code byte-identical to the never-warped exports');
  await T(() => window.CST.mkUndo()); await wait(400); ok(await T(() => JSON.stringify(window.T.node('floor_boards.png').warp)) === wFull && await T(() => JSON.stringify(window.CST.items.find(i => i.name === 'floor_boards.png').warp)) === wFull, 'reset can be undone (the printed image is warped again)');
  // Ctrl + corner drag works without Transform mode
  const hd3 = await T(() => { const C = window.CST, n = window.T.node('floor_boards.png'), H = C.mkWarpHandles(n, C.mkGeom(n)); return [window.T.screen(...H[3]), window.T.screen(H[3][0] - 0.3, H[3][1] + 0.2)]; });
  await p.keyboard.down('Control'); await p.mouse.move(...hd3[0]); await p.mouse.down(); await p.mouse.move(...hd3[1], { steps: 6 }); await p.mouse.up(); await p.keyboard.up('Control'); await wait(300);
  const w3 = await T(() => window.T.node('floor_boards.png').warp);
  ok(!(await T(() => window.CST.mkXf)) && Math.abs(w3.q[3][0] + 0.3) < 0.05 && Math.abs(w3.q[3][1] - 0.2) < 0.05, `Ctrl + drag a corner distorts without Transform mode (BL ${w3.q[3].map(v => v.toFixed(3)).join(', ')})`);
  await wait(400); const e2 = await T(() => window.T.exports());
  ok(e2.pdf !== base.pdf && e2.code === base.code && await T(() => JSON.stringify(window.CST.items.find(i => i.name === 'floor_boards.png').warp)) === JSON.stringify(w3), 'the Layout follows the new warp live (sheet code unchanged)');
  // per-image warp: a second copy with a different warp → Send to Layout splits it into "floor_boards.png (warped 2)"
  await T(() => window.CST.mkSelect(window.T.node('floor_boards.png'))); await p.focus('#mkCanvas'); await p.keyboard.press('d'); await wait(300);
  ok(await T(() => { const C = window.CST, ns = C.MK.nodes.filter(n => window.T.name(n) === 'floor_boards.png'); return ns.length === 2 && JSON.stringify(ns[1].warp) === JSON.stringify(ns[0].warp) && C.mkSel === ns[1]; }), 'D duplicates the piece with its warp');
  await T(() => { const e = document.querySelector('#mkSkX'); e.value = '10'; e.dispatchEvent(new Event('change')); }); await wait(300);
  ok(await T(() => /1 other copy of floor_boards\.png has a different warp/.test(document.querySelector('#mkWarpNote').textContent)), 'note: the other copy has a different warp (Send to Layout splits)');
  const sp = await T(() => { const C = window.CST, P = C.mkSendPlan(true); return { splits: P.splits.map(r => [r.name, r.k, r.warp && JSON.parse(r.warp).sx]), keep: P.keep.filter(r => r.it.name === 'floor_boards.png').map(r => r.k), images: P.images, pieces: P.pieces }; });
  ok(JSON.stringify(sp.splits) === JSON.stringify([['floor_boards.png (warped 2)', 1, 10]]) && sp.keep[0] === 1 && sp.images === 8 && sp.pieces === 8, `Send plan splits the differently warped copy: ${JSON.stringify(sp.splits)}, floor_boards.png × ${sp.keep[0]}, ${sp.images} images / ${sp.pieces} pieces`);
  const nItems = await T(() => window.CST.items.length);
  await T(() => window.CST.mkSendApply(window.CST.mkSendPlan(true))); await wait(800);
  const after = await T(() => { const C = window.CST, a = C.items.find(i => i.name === 'floor_boards.png'), b = C.items.find(i => i.name === 'floor_boards.png (warped 2)'), cnt = (it) => C.layout.sheets.flat().filter(e => e.it === it).length;
    return { n: C.items.length, a: [a.qty, a.warp && a.warp.sx, cnt(a)], b: b && [b.qty, b.warp.sx, cnt(b), C.processed(b, false).cutW !== C.processed(a, false).cutW], node: window.T.name(C.MK.nodes.filter(n => n.name.startsWith('floor_boards'))[1]) }; });
  ok(after.n === nItems + 1 && after.b && after.b[0] === 1 && after.b[1] === 10 && after.b[2] === 1 && after.b[3] && after.a[0] === 1 && after.a[2] === 1 && after.node === 'floor_boards.png (warped 2)', `after Send: Layout has floor_boards.png ×1 (its warp) and floor_boards.png (warped 2) ×1 (skew 10°), each cut to its own shape; the copy points at the new entry`);
  await T(() => window.CST.undo()); await wait(600);
  ok(await T((n) => window.CST.items.length === n && !window.CST.items.some(i => / \(warped 2\)$/.test(i.name)), nItems), 'Layout undo removes the split entry again');
  const nNodes = await T(() => window.CST.MK.nodes.length);
  await T(() => window.CST.mkSelect(null)); await wait(200);
  ok(await T(() => getComputedStyle(document.querySelector('#mkWarpNote')).display === 'none'), 'nothing selected: the warp note is hidden');
  // the plain localStorage autosave (no IndexedDB copy) also restores a warped mockup at startup
  await wait(2200); await T(() => localStorage.removeItem('cst.mkAuto')); await p.reload(); await wait(1500);
  const lsN = await T(() => { const n = window.CST.MK.nodes.find(n => n.name === 'floor_boards.png'); return { len: window.CST.MK.nodes.length, w: n && n.warp }; });
  ok(lsN.len === nNodes && JSON.stringify(lsN.w) === JSON.stringify(w3), `startup load of the saved mockup keeps all pieces and the warp (${lsN.len} pieces)`);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
