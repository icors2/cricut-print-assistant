// P2·M4: add a catalog asset at its size, a second copy is a node, projects keep asset.
const puppeteer = require('puppeteer-core'), path = require('path'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.list().length === 5, { timeout: 8000 });
  const added = await p.evaluate(async () => {
    const C = window.CST, a = C.assets.get('core.furniture.round-sofa');
    await C.assets.addAsset(a);
    await C.assets.addAsset(a);
    const it = C.items[0], keep = C.S.bleed; C.S.bleed = 0; C.cache.clear();
    const q = C.processed(it, false), pr = q.print, W = pr.canvas.width, H = pr.canvas.height, k = W / pr.w;
    const alpha = pr.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, -pr.x * k, -pr.y * k); const P = new Path2D();
    for (const l of q.loops) for (const sg of l) { if (sg[0] === 'M') P.moveTo(sg[1], sg[2]); else if (sg[0] === 'L') P.lineTo(sg[1], sg[2]); else P.closePath(); }
    g.fillStyle = '#000'; g.fill(P); const mask = g.getImageData(0, 0, W, H).data;
    let both = 0, ao = 0, bo = 0;
    for (let i = 3; i < alpha.length; i += 4) { const A = alpha[i] >= 128, B = mask[i] >= 128; if (A && B) both++; else if (A) ao++; else if (B) bo++; }
    C.S.bleed = keep; C.cache.clear();
    const proj = JSON.parse(JSON.stringify(C.items.map(i => i.asset)));
    return { nItems: C.items.length, nNodes: C.MK.nodes.length, w: it.wIn, h: it.hIn, shape: it.shape, iou: both / (both + ao + bo), asset: proj[0] };
  });
  ok(added.nItems === 1 && added.nNodes === 2, 'the same asset adds a node, not a second item (' + added.nItems + ' items, ' + added.nNodes + ' nodes)');
  ok(Math.abs(added.w - 2.5) < 0.01 && Math.abs(added.h - 1.4) < 0.01 && added.shape === 'contour', 'catalog size and contour cut (' + added.w + '×' + added.h + ' ' + added.shape + ')');
  ok(added.iou > 0.98, 'print alpha matches the cut (IoU ' + added.iou.toFixed(4) + ')');
  ok(added.asset && added.asset.id === 'core.furniture.round-sofa', 'the item remembers the asset id');
  const saved = await p.evaluate(() => {
    const text = JSON.stringify(window.CST.projectData());
    return { has: text.includes('core.furniture.round-sofa'), noWarp: !/"warp"/.test(text) };
  });
  const file = await p.evaluate(() => {
    const data = { items: window.CST.items.map(i => i.asset ? { asset: i.asset } : {}) };
    return JSON.stringify(data);
  });
  ok(file.includes('core.furniture.round-sofa'), 'a project keeps the asset field');
  const bg = await p.evaluate(async () => {
    const C = window.CST, a = C.assets.get('core.rooms.sunny-room'), text = await C.assets.file(a, 'svg');
    C.MK.bg.img = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
    C.MK.bg.fit = 'fill'; C.mkCommit();
    return C.MK.bg.fit === 'fill' && !!C.MK.bg.img;
  });
  ok(bg, 'a room can be the mockup background');
  ok(saved.noWarp, 'an unwarped asset does not invent a warp');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
