// P1·M3: manifest, service worker, offline reload, cache purge.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  const man = JSON.parse(fs.readFileSync(path.join(R, 'manifest.webmanifest'), 'utf8'));
  ok(man.display === 'standalone' && man.short_name === 'Sticker Studio' && man.start_url === './', 'manifest display, name and start_url');
  for (const ic of man.icons) {
    const buf = fs.readFileSync(path.join(R, ic.src));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    ok(ic.sizes === w + 'x' + h, ic.src + ' is ' + w + 'x' + h);
  }
  const apple = fs.readFileSync(path.join(R, 'icons', 'apple-touch-icon-180.png'));
  ok(apple.readUInt32BE(16) === 180, 'apple touch icon is 180');
  const sw = fs.readFileSync(path.join(R, 'sw.js'), 'utf8');
  const cat = fs.existsSync(path.join(R, 'assets', 'catalog.json')) ? fs.readFileSync(path.join(R, 'assets', 'catalog.json')) : Buffer.alloc(0);
  const hash = crypto.createHash('sha256').update(Buffer.concat([fs.readFileSync(path.join(R, 'index.html')), cat])).digest('hex').slice(0, 12);
  ok(sw.includes("const CACHE = 'cpa-" + hash + "'"), 'cache name is cpa-' + hash);
  ok(/caches\.delete/.test(sw), 'activate deletes old cpa- caches');

  const b = await puppeteer.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome'), headless: 'new', args: ['--no-sandbox'] });
  const filePage = await b.newPage();
  const ferrs = []; filePage.on('pageerror', e => ferrs.push(String(e)));
  await filePage.goto('file://' + path.join(R, 'index.html')); await wait(400);
  const tried = await filePage.evaluate(() => window.CST.pwa ? window.CST.pwa.tried : 'missing');
  ok(tried === false && !ferrs.length, 'file:// does not register a service worker (' + tried + ') errors ' + ferrs.join('; '));
  const fileInstall = await filePage.evaluate(() => { const b = document.querySelector('#pwaInstall'); return { there: !!b, hidden: !!(b && b.hidden) }; });
  ok(fileInstall.there && fileInstall.hidden, 'file:// hides Add to Home Screen');

  const srv = await serve();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: 8000 }).catch(() => {});
  await wait(500);
  const reg = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { active: !!(r && r.active), ctrl: !!navigator.serviceWorker.controller };
  });
  ok(reg.active, 'service worker registers on localhost (controller ' + reg.ctrl + ')');
  await p.evaluate(async () => {
    const c = await caches.open('cpa-stale');
    await c.put(new Request(location.origin + '/stale-probe'), new Response('x'));
    const reg = await navigator.serviceWorker.ready;
    reg.active.postMessage('purge');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="1in" viewBox="0 0 10 10"><rect width="10" height="10" fill="#39c"/></svg>';
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    await window.CST.addFromDataURL('dot', url, url, true, {});
    window.CST.refresh(true);
    await window.CST.mkIdbAuto();
  });
  await wait(400);
  const gone = await p.evaluate(async () => !(await caches.keys()).includes('cpa-stale'));
  ok(gone, 'purge drops a stale cpa- cache');
  await p.setOfflineMode(true);
  await p.reload({ waitUntil: 'domcontentloaded' }); await wait(900);
  const off = await p.evaluate(() => ({ n: window.CST.items.length, pdf: window.CST.items.length ? window.CST.buildPDF().output('arraybuffer').byteLength : 0 }));
  ok(off.n >= 1 && off.pdf > 1000, 'offline reload restores the sheet and exports a PDF (' + off.n + ' images, ' + off.pdf + ' bytes)');
  const install = await p.evaluate(() => { const b = document.querySelector('#pwaInstall'); if (b) b.click(); const s = document.querySelector('#installSheet'); return { shown: !!(b && !b.hidden), open: !!(s && !s.hidden), text: s ? s.innerText : '' }; });
  ok(install.shown && install.open && /Share/.test(install.text) && /Add to Home Screen/.test(install.text), 'Add to Home Screen shows the iPad steps');
  await p.evaluate(() => document.querySelector('#installClose').click());
  ok(await p.evaluate(() => document.querySelector('#installSheet').hidden), 'Got it closes the steps');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  srv.child.kill();
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
