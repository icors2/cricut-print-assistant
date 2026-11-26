// P2·M2: file:// does not fetch, http loads the catalog, the bundle inlines it, index.html does not.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  const index = fs.readFileSync(path.join(R, 'index.html'));
  ok(index.length < 800 * 1024, 'index.html stays under 800 KB (' + index.length + ')');
  ok(!index.includes('id="cstAssets"'), 'index.html does not inline the catalog');
  execFileSync(py, [path.join(R, 'build.py'), '--bundle-assets'], { cwd: R, stdio: 'inherit' });
  const bundledPath = path.join(R, 'app', 'cricut_print_assistant_bundled.html');
  const bundled = fs.readFileSync(bundledPath, 'utf8');
  const start = bundled.indexOf('id="cstAssets">') + 'id="cstAssets">'.length;
  const blob = bundled.slice(start, bundled.indexOf('</script>', start));
  ok(bundled.includes('id="cstAssets"') && !blob.includes('</'), 'the bundled JSON escapes </');
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const filePage = await b.newPage();
  await filePage.goto('file://' + path.join(R, 'index.html')); await wait(400);
  const fileSrc = await filePage.evaluate(() => window.CST.assets.source);
  ok(fileSrc === 'none', 'file:// does not fetch the catalog (' + fileSrc + ')');
  const bundlePage = await b.newPage();
  await bundlePage.goto('file://' + bundledPath); await wait(500);
  const got = await bundlePage.evaluate(() => ({ source: window.CST.assets.source, n: window.CST.assets.list().length, embedded: window.CST.EMBEDDED }));
  ok(got.source === 'bundled' && got.n === 5, 'the bundled file loads 5 assets offline (' + got.source + ' ' + got.n + ')');
  ok(got.embedded === null || got.embedded === false || got.embedded == null, 'bundled file keeps the embedded-calibration slot empty');
  const srv = await serve();
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.list().length === 5, { timeout: 8000 });
  const http = await p.evaluate(() => window.CST.assets.source);
  ok(http === 'fetch', 'http loads assets/catalog.json (' + http + ')');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
