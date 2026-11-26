// P4·M3: an avatar exports as one 2×3 in contour sticker and can be edited in place.
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
  await p.waitForFunction(() => window.CST && window.CST.avatar && window.CST.assets.avatarParts(), { timeout: 8000 });
  const r = await p.evaluate(async () => {
    const C = window.CST, spec = C.assets.avatarParts().presets[0];
    const full = { schema: 'cpa-avatar-spec/1', template: 'kid-v1', parts: spec.parts, colors: spec.colors };
    const it = await C.avatar.toItem(full);
    const keep = C.S.bleed; C.S.bleed = 0; C.cache.clear();
    const q = C.processed(it, false), pr = q.print, W = pr.canvas.width, H = pr.canvas.height, k = W / pr.w;
    const alpha = pr.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, -pr.x * k, -pr.y * k); const P = new Path2D();
    for (const l of q.loops) for (const sg of l) { if (sg[0] === 'M') P.moveTo(sg[1], sg[2]); else if (sg[0] === 'L') P.lineTo(sg[1], sg[2]); else P.closePath(); }
    g.fillStyle = '#000'; g.fill(P); const mask = g.getImageData(0, 0, W, H).data;
    let both = 0, ao = 0, bo = 0;
    for (let i = 3; i < alpha.length; i += 4) { const A = alpha[i] >= 128, B = mask[i] >= 128; if (A && B) both++; else if (A) ao++; else if (B) bo++; }
    const edited = Object.assign({}, full, { colors: Object.assign({}, full.colors, { skin: '#8d5524' }) });
    const svg = await C.avatar.compose(edited);
    const dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    it.dataURL = dataURL; it.asset.avatar = edited;
    it.img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataURL; });
    C.S.bleed = keep; C.cache.clear();
    return { w: it.wIn, h: it.hIn, shape: it.shape, off: it.offsetIn, kind: it.asset.kind, loops: q.loops.length, iou: both / (both + ao + bo), skin: it.asset.avatar.colors.skin };
  });
  ok(r.w === 2 && r.h === 3 && r.shape === 'contour' && r.off === 0.04 && r.kind === 'avatar', 'export is a 2×3 in contour avatar (offset ' + r.off + ')');
  ok(r.loops === 1, 'the preset cuts as one piece (' + r.loops + ' loops)');
  ok(r.iou > 0.98, 'print alpha matches the cut (IoU ' + r.iou.toFixed(4) + ')');
  ok(r.skin === '#8d5524', 'editing keeps the new spec on the same item');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });