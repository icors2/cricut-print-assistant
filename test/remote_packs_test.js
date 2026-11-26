// Optional remote pack sync ("Sync family packs") against a local mock pack index.
const puppeteer = require('puppeteer-core'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), zlib = require('zlib'), crypto = require('crypto'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function zip(files) {
  const parts = []; for (const [name, data] of Object.entries(files)) {
    const nameB = Buffer.from(name), comp = zlib.deflateRawSync(data), local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, comp);
  }
  return Buffer.concat(parts);
}
function pack(id, version) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c33"/></svg>';
  const catalog = { schema: 'cpa-catalog/1', pack: { id, name: 'Pack ' + id, version, license: 'LicenseRef-Private' }, categories: [{ id: 'items', name: 'Items', order: 1 }],
    assets: [{ id: id + '.items.box', name: 'Box ' + id, category: 'items', size: { w: 1, h: 1 }, files: { svg: 'box.svg', thumb: 'box.svg' }, cut: { shape: 'contour', offset: 0 }, license: 'LicenseRef-Private', author: 'Owner', source: 'original', added: '2026-11-26' }] };
  return zip({ 'pack.json': Buffer.from(JSON.stringify(catalog)), 'box.svg': Buffer.from(svg + '<!--' + 'x'.repeat(3000) + '-->') });
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const files = {}; let index = null; const hits = [];
function setIndex(alpha, beta, opt) {
  opt = opt || {};
  const a = pack('alpha', alpha), b = pack('beta', beta);
  const cut = Math.floor(a.length / 3), aParts = [a.subarray(0, cut), a.subarray(cut, 2 * cut), a.subarray(2 * cut)];
  aParts.forEach((p, i) => { files[`/packs/alpha/${alpha}/alpha.cpapack.zip.${i}`] = p; });
  files[`/packs/beta/${beta}/beta.cpapack.zip`] = b;
  index = { schema: 'cpa-pack-index/1', packs: [
    { id: 'alpha', name: 'Alpha', version: alpha, file: 'alpha.cpapack.zip', bytes: a.length, sha256: sha(a), parts: aParts.map((_, i) => `alpha/${alpha}/alpha.cpapack.zip.${i}`) },
    { id: 'beta', name: 'Beta', version: beta, file: 'beta.cpapack.zip', bytes: b.length, sha256: opt.badSha ? '0'.repeat(64) : sha(b), url: `beta/${beta}/beta.cpapack.zip` }] };
}
let locked = false;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith('/packs/')) {
    hits.push(u);
    if (locked) { res.writeHead(302, { Location: 'https://example.invalid/login' }); res.end(); return; }
    if (u === '/packs/index.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(index)); return; }
    if (files[u]) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(files[u]); return; }
    res.writeHead(404); res.end(); return;
  }
  if (u.endsWith('/')) u += 'index.html';
  const f = path.normalize(path.join(R, u));
  if (!f.startsWith(R)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf); });
});
(async () => {
  // build.py --pack-index writes the meta tag, and the public build leaves it empty.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-idx-'));
  for (const d of ['src', 'vendor']) fs.cpSync(path.join(R, d), path.join(tmp, d), { recursive: true });
  fs.copyFileSync(path.join(R, 'build.py'), path.join(tmp, 'build.py'));
  execFileSync('python3', [path.join(tmp, 'build.py'), '--pack-index', '/packs/index.json'], { cwd: tmp, stdio: 'ignore' });
  ok(fs.readFileSync(path.join(tmp, 'index.html'), 'utf8').includes('<meta name="cpa-pack-index" content="/packs/index.json">'), 'build.py --pack-index sets the index URL');
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(fs.readFileSync(path.join(R, 'index.html'), 'utf8').includes('<meta name="cpa-pack-index" content="">'), 'the public build has no pack index');

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const ctx = await b.createBrowserContext();
  let p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto(origin + '/');
  await p.waitForFunction(() => window.CST && window.CST.remotePacks && window.CST.assets, { timeout: 8000 });
  await new Promise(r => setTimeout(r, 500));
  ok(await p.evaluate(() => !window.CST.remotePacks.enabled() && !document.getElementById('packSync')), 'off by default: no Sync button');
  ok(hits.length === 0, 'off by default: nothing fetched from /packs');

  setIndex('1.0.0', '1.0.0');
  await p.evaluate(() => localStorage.setItem('cst.packIndex', '/packs/index.json'));
  await p.reload();
  await p.waitForFunction(() => window.CST && window.CST.remotePacks && document.getElementById('packSync'), { timeout: 8000 });
  ok(true, 'Sync family packs button shows when an index is set');
  await p.waitForFunction(() => window.CST.assets.get('alpha.items.box') && window.CST.assets.get('beta.items.box'), { timeout: 10000 }).catch(() => {});
  const auto = await p.evaluate(() => ({ a: !!window.CST.assets.get('alpha.items.box'), b: !!window.CST.assets.get('beta.items.box') }));
  ok(auto.a && auto.b, 'auto-sync on start imports both packs (split and whole)');
  ok(hits.filter(h => h.includes('alpha.cpapack.zip.')).length === 3, 'the split pack was fetched in 3 parts');

  hits.length = 0;
  await p.reload();
  await p.waitForFunction(() => window.CST && window.CST.remotePacks && window.CST.assets, { timeout: 8000 });
  const again = await p.evaluate(() => window.CST.remotePacks.sync({ quiet: true }));
  ok(again.added.length === 0 && again.skipped.length === 2, 'packs already imported are skipped');
  ok(!hits.some(h => h !== '/packs/index.json'), 'no pack file is downloaded again');
  ok(await p.evaluate(() => !!window.CST.assets.get('alpha.items.box')), 'packs stay after reload (IndexedDB)');

  setIndex('1.1.0', '1.0.0'); hits.length = 0;
  const bump = await p.evaluate(() => window.CST.remotePacks.sync({ quiet: true }));
  ok(bump.added.join() === 'alpha' && !hits.some(h => h.includes('/beta/')), 'a new version re-downloads only that pack');
  ok(await p.evaluate(async () => (await window.CST.idbPacks()).find(r => r.id === 'alpha').meta.version === '1.1.0'), 'the stored pack is the new version');

  setIndex('1.1.0', '2.0.0', { badSha: true });
  const bad = await p.evaluate(() => window.CST.remotePacks.sync({ quiet: true }));
  ok(bad.added.length === 0 && bad.errors.some(e => /checksum/.test(e)), 'a checksum mismatch is refused');
  ok(await p.evaluate(async () => (await window.CST.idbPacks()).find(r => r.id === 'beta').meta.version === '1.0.0'), 'the old pack is kept when an update fails');

  locked = true;
  const auth = await p.evaluate(() => window.CST.remotePacks.sync({ quiet: true }));
  ok(auth.errors.some(e => /Sign-in/.test(e)), 'a sign-in redirect is reported, not followed');
  locked = false;

  await b.close(); server.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
