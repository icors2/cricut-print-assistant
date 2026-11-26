// P1·M2: two-finger pinch, twist, long-press, one undo step, big targets, export identity.
const puppeteer = require('puppeteer-core');
const { KnownDevices } = puppeteer;
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const R = require('path').resolve(__dirname, '..');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1.6in" viewBox="0 0 200 160"><rect width="200" height="160" fill="#7fb3d5"/></svg>';
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome'), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.emulate(KnownDevices['iPad Pro 11']);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + R + '/index.html');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; });
  await p.reload(); await wait(400);
  await p.evaluate(async (svg) => {
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    await window.CST.addFromDataURL('box', url, url, true, { wIn: 2, hIn: 1.6 });
    window.CST.refresh(true);
  }, SVG);
  await wait(400);
  await p.evaluate(() => { document.querySelector('[data-tab=tabMock]').click(); const C = window.CST, n = C.MK.nodes[0]; if (!n) throw new Error('no mockup node'); C.mkSelect(n); C.S.ui = Object.assign({}, C.S.ui, { bigTargets: true }); C.applyChrome(); });
  await wait(300);
  const center = () => p.evaluate(() => {
    const C = window.CST, n = C.mkSel; if (!n) throw new Error('nothing selected, nodes ' + C.MK.nodes.length);
    const g = C.mkGeom(n), c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = C.mkView, k = r.width / c.width;
    const widthPx = g.w * v.sc * k;
    return { x: r.left + (v.pad + n.x * v.sc) * k, y: r.top + (v.pad + n.y * v.sc) * k, w: C.nodeItem(n).wIn, h: C.nodeItem(n).hIn, rot: n.rot, undo: C.mkUndoDepth, zoom: C.MK.zoom || 1, span: Math.max(28, Math.min(80, widthPx * 0.45)) };
  });
  const cdp = await p.target().createCDPSession();
  const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(q => ({ x: q.x, y: q.y, id: q.id, radiusX: 2, radiusY: 2 })) });
  const s0 = await center();
  const spread = (cx, cy, d, deg) => {
    const a = (deg || 0) * Math.PI / 180, dx = Math.cos(a) * d / 2, dy = Math.sin(a) * d / 2;
    return [{ x: cx - dx, y: cy - dy, id: 0 }, { x: cx + dx, y: cy + dy, id: 1 }];
  };
  await touch('touchStart', spread(s0.x, s0.y, s0.span, 0));
  await touch('touchMove', spread(s0.x, s0.y, s0.span * 1.5, 40));
  await touch('touchEnd', []);
  await wait(500);
  const s1 = await center();
  ok(Math.abs(s1.w / s0.w - 1.5) < 0.02 && Math.abs(s1.h / s0.h - 1.5) < 0.02, `pinch ×1.5: ${s0.w.toFixed(3)} → ${s1.w.toFixed(3)} (h ${s1.h.toFixed(3)})`);
  ok(Math.abs(s1.rot - 40) < 1, 'twist 40° rotates by ' + s1.rot.toFixed(2) + '°');
  ok(s1.undo === s0.undo + 1, 'scale + rotate is one undo step (' + s0.undo + ' → ' + s1.undo + ')');
  await p.evaluate(() => window.CST.mkUndo()); await wait(300);
  const sBack = await center();
  ok(Math.abs(sBack.w - s0.w) < 1e-6 && Math.abs(sBack.rot) < 1e-6, 'one undo restores size and rotation');

  // 44° snaps to 45
  const s2 = await center();
  await touch('touchStart', spread(s2.x, s2.y, s2.span, 0));
  await touch('touchMove', spread(s2.x, s2.y, s2.span, 44));
  await touch('touchEnd', []);
  await wait(400);
  const s3 = await center();
  ok(Math.abs(s3.rot - 45) < 0.6, '44° snaps to 45°, got ' + s3.rot.toFixed(2));
  await p.evaluate(() => window.CST.mkUndo()); await wait(200);

  // empty-canvas pinch changes zoom only
  const empty = await p.evaluate(() => {
    const C = window.CST, c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = C.mkView, k = r.width / c.width;
    const x = 0.3, y = 0.3;
    return { x: r.left + (v.pad + x * v.sc) * k, y: r.top + (v.pad + y * v.sc) * k, nodes: JSON.stringify(C.MK.nodes.map(n => [n.uid, n.x, n.y, n.rot, n.itemId, n.flip])), zoom: C.MK.zoom || 1 };
  });
  await touch('touchStart', spread(empty.x, empty.y, 80, 0));
  await touch('touchMove', spread(empty.x, empty.y, 160, 0));
  await touch('touchEnd', []);
  await wait(200);
  const empty2 = await p.evaluate(() => ({ nodes: JSON.stringify(window.CST.MK.nodes.map(n => [n.uid, n.x, n.y, n.rot, n.itemId, n.flip])), zoom: window.CST.MK.zoom || 1 }));
  ok(empty2.nodes === empty.nodes, 'pinch on empty canvas does not move nodes');
  ok(Math.abs(empty2.zoom - empty.zoom * 2) < 0.05 || empty2.zoom > empty.zoom + 0.2, 'empty pinch changes zoom ' + empty.zoom + ' → ' + empty2.zoom);

  // long-press duplicate keeps the warp
  await p.evaluate(() => { const n = window.CST.mkSel || window.CST.MK.nodes[0]; n.warp = { sx: 12, sy: 0, q: [[0, 0], [0, 0], [0, 0], [0, 0]] }; window.CST.mkSelect(n); window.CST.mkCommit(); });
  await wait(200);
  const lp = await center();
  await touch('touchStart', [{ x: lp.x, y: lp.y, id: 0 }]);
  await wait(700);
  const shown = await p.evaluate(() => !document.querySelector('#touchCtx').hidden && document.querySelector('#touchCtx [data-act=dup]') != null);
  await touch('touchEnd', []);
  ok(shown, 'long-press shows the context bar');
  const beforeN = await p.evaluate(() => window.CST.MK.nodes.length);
  await p.evaluate(() => document.querySelector('#touchCtx [data-act=dup]').click());
  await wait(200);
  const dup = await p.evaluate(() => { const ns = window.CST.MK.nodes; const a = ns[ns.length - 1]; return { n: ns.length, sx: a && a.warp && a.warp.sx }; });
  ok(dup.n === beforeN + 1 && dup.sx === 12, 'Duplicate adds a copy that inherits the warp (' + JSON.stringify(dup) + ')');

  // big targets
  const small = await p.evaluate(() => [...document.querySelectorAll('#tabMock button, #touchBar button')].filter(el => el.offsetParent && (el.offsetWidth < 44 || el.offsetHeight < 44)).map(el => (el.id || el.className || el.textContent || '').trim().slice(0, 40)));
  ok(!small.length, 'big targets are at least 44px: ' + small.join(', '));

  // a gesture and the same numbers typed through the mouse API export the same bytes
  const exp = await p.evaluate(() => {
    const C = window.CST;
    C.MK.nodes = C.MK.nodes.slice(0, 1); const n = C.MK.nodes[0], it = C.nodeItem(n);
    n.warp = null; n.rot = 0; n.flip = false; it.wIn = 2; it.hIn = 1.6; C.mkSelect(n); C.mkCommit(); C.refresh(true);
    return { w: it.wIn, h: it.hIn };
  });
  await wait(200);
  const g0 = await center();
  await touch('touchStart', spread(g0.x, g0.y, g0.span, 0));
  await touch('touchMove', spread(g0.x, g0.y, g0.span * 1.25, 0));
  await touch('touchEnd', []);
  await wait(400);
  const same = await p.evaluate(() => {
    const C = window.CST, n = C.MK.nodes[0], it = C.nodeItem(n);
    const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } }
    const shot = () => { window.Date = FD; try { C.computeLayout(); const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); const u = new Uint8Array(d.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) + '\n' + C.buildSVGs().join('\n'); } finally { window.Date = RD; } };
    const w = it.wIn, h = it.hIn, rot = n.rot, viaGesture = shot();
    C.mkUndo(); it.wIn = 2; it.hIn = 1.6; n.rot = 0;
    C.mkSetSize(it, w, h); C.mkSetRot(n, rot); C.mkCommit(); C.refresh(true); C.computeLayout();
    return { same: viaGesture === shot(), w, h, rot };
  });
  ok(same.same, 'gesture end state matches a mouse edit export (' + same.w.toFixed(3) + ' × ' + same.h.toFixed(3) + ')');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
