// A folder of pictures becomes a private pack, and Save to library posts each one.
const puppeteer = require('puppeteer-core'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..');
const { buildPack } = require('../tools/make_pack.js');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function validate(cat) {
  const api = {};
  const sandbox = {
    window: { CST: { registerModule: (n, a) => Object.assign(api, a), bus: { emit() {} } } },
    document: { getElementById: () => null, readyState: 'loading', addEventListener() {} },
    location: { protocol: 'file:' }, console, indexedDB: { open() { return { result: null }; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(R, 'src', 'modules', 'assets.js'), 'utf8'), sandbox);
  return api.validateCatalog(cat, { publicRepo: false });
}
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packtest-'));
  const chars = fs.mkdtempSync(path.join(os.tmpdir(), 'packchars-'));
  fs.mkdirSync(path.join(chars, 'characters'));
  fs.writeFileSync(path.join(dir, 'dot.png'), PNG);
  fs.writeFileSync(path.join(chars, 'characters', 'bear.png'), PNG);
  const built = await buildPack(dir, { id: 'mine', thumbs: 'source', name: 'Mine' });
  const errs = validate(built.catalog);
  ok(!errs.length, 'the pack catalog is valid (' + errs.map(e => e.path + ' ' + e.msg).join('; ') + ')');
  ok(built.catalog.pack.id === 'mine' && built.catalog.assets.length === 1 && built.catalog.assets[0].id === 'mine.items.dot', 'a loose picture lands in items');
  ok(built.catalog.assets[0].license === 'LicenseRef-Private' && built.catalog.assets[0].size.w === 2 && built.files['dot.png'], 'the zip carries the PNG at a 2 inch long side');
  const sub = await buildPack(chars, { id: 'mine', thumbs: 'source', write: false });
  ok(sub.catalog.assets[0].category === 'characters' && sub.catalog.assets[0].id === 'mine.characters.bear', 'a characters folder sets the category');
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('dialog', d => d.accept());
  const errsPage = []; p.on('pageerror', e => errsPage.push(e.message));
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets_ui && window.CST.extract, { timeout: 8000 });
  await p.click('[data-tab=tabAssets]');
  await p.waitForSelector('[data-cat="__packs"]', { timeout: 4000 });
  await p.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await window.CST.assets_ui.importPack(new File([bytes], 'mine.cpapack.zip', { type: 'application/zip' }));
  }, built.zip.toString('base64'));
  await p.click('[data-cat="__packs"]');
  await p.waitForSelector('[data-save="mine"]', { timeout: 4000 });
  await p.evaluate(() => {
    document.querySelector('#packToken').value = 'test-token';
    window.__posts = [];
    const orig = window.fetch.bind(window);
    window.fetch = (url, opt) => {
      if (String(url).includes('/api/assets') && opt && opt.method === 'POST') {
        window.__posts.push(JSON.parse(opt.body));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return orig(url, opt);
    };
  });
  await p.click('[data-save="mine"]');
  await p.waitForFunction(() => window.__posts && window.__posts.length === 1, { timeout: 8000 });
  const post = await p.evaluate(() => window.__posts[0]);
  ok(post.entry.id.startsWith('library.') && post.entry.license === 'CC0-1.0' && String(post.png).startsWith('data:image/png'), 'Save to library posts one PNG as a library sticker (' + (post.entry && post.entry.id) + ')');
  ok(!errsPage.length, 'no page errors ' + JSON.stringify(errsPage));
  srv.child.kill(); await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(chars, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
