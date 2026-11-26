// P4·M2: the builder names its buttons and keeps them big enough to tap.
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
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.avatarParts(), { timeout: 8000 });
  await p.evaluate(() => { window.CST.S.ui = Object.assign({}, window.CST.S.ui, { bigTargets: true }); window.CST.applyChrome(); });
  await p.click('[data-tab=tabAvatar]');
  await p.waitForSelector('#avatarSlots button[aria-label]');
  const r = await p.evaluate(() => {
    const buttons = [...document.querySelectorAll('#avatarSlots button')];
    const named = buttons.every(b => b.getAttribute('aria-label'));
    const box = buttons[0].getBoundingClientRect();
    return { named, n: buttons.length, w: box.width, h: box.height, preview: !!document.querySelector('#avatarPreview svg') };
  });
  ok(r.named && r.n > 4, 'every part button has an accessible name (' + r.n + ')');
  ok(r.w >= 44 && r.h >= 44, 'part buttons are at least 44 px (' + r.w.toFixed(0) + '×' + r.h.toFixed(0) + ')');
  ok(r.preview, 'the live preview is an SVG');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
