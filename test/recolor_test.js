// P3·M1: recolor changes paint only. Alpha and the cut loops stay the same.
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
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.get('core.furniture.round-sofa'), { timeout: 8000 });
  const r = await p.evaluate(async () => {
    const C = window.CST, asset = C.assets.get('core.furniture.round-sofa');
    const src = await C.assets.file(asset, 'svg');
    const once = C.recolor.apply(src, { fabric: '#ff00aa', cushion: '#00aa88', legs: '#333333' }, asset.regions);
    const twice = C.recolor.apply(once, { fabric: '#ff00aa', cushion: '#00aa88', legs: '#333333' }, asset.regions);
    let style = ''; try { C.recolor.apply('<svg xmlns="http://www.w3.org/2000/svg"><style></style></svg>', { fabric: '#112233' }); } catch (e) { style = e.message; }
    let none = ''; try { C.recolor.apply(src, { fabric: 'none' }, asset.regions); } catch (e) { none = e.message; }
    const load = (t) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t))); });
    const opt = { wIn: asset.size.w, hIn: asset.size.h, shape: 'contour', offsetIn: 0.04, bleedIn: 0, border: 'extend', dpi: 300 };
    const A = window.CSTCore.processItem(await load(src), opt), B = window.CSTCore.processItem(await load(once), opt);
    const ad = A.print.canvas.getContext('2d').getImageData(0, 0, A.print.canvas.width, A.print.canvas.height).data;
    const bd = B.print.canvas.getContext('2d').getImageData(0, 0, B.print.canvas.width, B.print.canvas.height).data;
    let diff = 0; for (let i = 3; i < ad.length; i += 4) if (ad[i] !== bd[i]) diff++;
    return { same: once === twice, fill: /fill="#ff00aa"/.test(once), style, none, diff, loops: JSON.stringify(A.loops) === JSON.stringify(B.loops) };
  });
  ok(r.fill && r.same, 'apply changes the fill and a second apply is a no-op');
  ok(/style block/.test(r.style), 'a style block is rejected');
  ok(/colour/.test(r.none), 'none is rejected');
  ok(r.diff === 0 && r.loops, 'alpha matches at 300 dpi (' + r.diff + ' pixels) and the cut loops are unchanged');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
