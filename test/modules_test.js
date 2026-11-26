// P1·M1: module registry, event bus, and the ORDER check in build.py.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), HTML = path.join(R, 'index.html');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome'), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + HTML); await wait(400);
  ok(!errs.length, 'page loads with no console errors: ' + JSON.stringify(errs));
  const r = await p.evaluate(async () => {
    const C = window.CST;
    const out = { hasReg: typeof C.registerModule === 'function', hasOn: !!(C.bus && C.bus.on && C.bus.emit) };
    let got = null; const off = C.bus.on('ping', (d) => { got = d; }); C.bus.emit('ping', 7); off();
    out.got = got;
    let threw = false; C.registerModule('probe', { ok: true }); try { C.registerModule('probe', {}); } catch (e) { threw = /twice/.test(e.message); }
    out.threw = threw;
    let fired = 0; C.bus.on('items:changed', () => { fired++; });
    C.refresh(false); await new Promise(res => setTimeout(res, 80));
    out.fired = fired;
    return out;
  });
  ok(r.hasReg && r.hasOn && r.got === 7, 'registerModule, bus.on and bus.emit work');
  ok(r.threw, 'registering the same name twice throws');
  ok(r.fired >= 1, 'items:changed fires after refresh()');
  await b.close();

  const orphan = path.join(R, 'src', 'modules', 'zz_orphan.js');
  fs.writeFileSync(orphan, '(function () { "use strict"; })();\n');
  let code = 0, msg = '';
  try { execFileSync(py, [path.join(R, 'build.py')], { cwd: R, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status || 1; msg = (e.stderr || e.stdout || '') + ''; }
  fs.unlinkSync(orphan);
  execFileSync(py, [path.join(R, 'build.py')], { cwd: R, stdio: 'inherit' });
  ok(code !== 0 && /ORDER mismatch/.test(msg), 'a module left out of ORDER makes build.py exit non-zero: ' + msg.trim().split('\n').pop());
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
