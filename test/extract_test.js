// Extractor: knockout, catalog entry, and a mocked save. The worker is tested with a fake bucket.
const puppeteer = require('puppeteer-core'), path = require('path'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function bucket() {
  const map = new Map();
  return {
    map,
    async get(key) {
      const v = map.get(key);
      if (!v) return null;
      return {
        body: v.body, httpEtag: '"1"',
        writeHttpMetadata(h) { if (v.type) h.set('content-type', v.type); },
        async text() { return typeof v.body === 'string' ? v.body : new TextDecoder().decode(v.body); }
      };
    },
    async put(key, body, opts) {
      map.set(key, { body, type: opts && opts.httpMetadata && opts.httpMetadata.contentType });
    }
  };
}
function call(method, pathname, body, token) {
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (token) init.headers.authorization = 'Bearer ' + token;
  if (body != null) init.body = JSON.stringify(body);
  return new Request('http://127.0.0.1' + pathname, init);
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
  const { buildLibraryCatalog } = require('../tools/seed_r2.js');
  const seeded = buildLibraryCatalog(R);
  ok(seeded.catalog.pack.id === 'library' && seeded.catalog.assets.every(a => a.id.startsWith('library.')), 'seed rewrites the starter catalog into the library pack');
  ok(seeded.catalog.categories.some(c => c.id === 'characters' && c.order === 5), 'the starter catalog has a Characters category');
  ok(seeded.catalog.categories.some(c => c.id === 'clothing' && c.order === 6), 'the starter catalog has a Clothing category');
  ok(seeded.files.length > 5 && seeded.files.every(f => f.key === 'catalog.json' || f.abs), 'seed points at real files (' + seeded.files.length + ')');

  const worker = await import('../worker/index.js');
  const png = worker.decodePng(PNG);
  ok(png && png[0] === 0x89, 'a PNG data URL decodes');
  const lib = bucket();
  const env = {
    LIBRARY: lib, ASSET_WRITE_TOKEN: 'test-token',
    ASSETS: { async fetch() { return new Response('static', { status: 200, headers: { 'content-type': 'text/plain' } }); } }
  };
  const entry = {
    id: 'library.items.red-dot', name: 'Red dot', category: 'items', tags: [],
    size: { w: 2, h: 2 }, files: { png: 'png/nope.png', thumb: 'thumbs/nope.png' },
    cut: { shape: 'contour', offset: 0.04 }, license: 'CC0-1.0',
    author: 'Cricut Print Assistant contributors', source: 'original', added: '2026-11-27'
  };
  const denied = await worker.handleRequest(call('POST', '/api/assets', { entry, png: PNG, thumb: PNG }, ''), env);
  ok(denied.status === 401, 'a save without the token is refused');
  const saved = await worker.handleRequest(call('POST', '/api/assets', { entry, png: PNG, thumb: PNG }, 'test-token'), env);
  ok(saved.status === 200, 'a save with the token is stored (' + saved.status + ')');
  const again = await worker.handleRequest(call('POST', '/api/assets', { entry, png: PNG, thumb: PNG }, 'test-token'), env);
  ok(again.status === 409, 'the same id cannot be saved twice');
  ok(lib.map.has('png/library.items.red-dot.png') && lib.map.has('thumbs/library.items.red-dot.png'), 'png and thumb use the library key');
  const got = await worker.handleRequest(call('GET', '/assets/catalog.json'), env);
  const cat = JSON.parse(await got.text());
  ok(cat.assets.length === 1 && cat.assets[0].name === 'Red dot' && cat.assets[0].files.png === 'png/library.items.red-dot.png', 'the catalog in the bucket has the new sticker');
  const blue = Object.assign({}, entry, { id: 'library.items.blue-dot', name: 'Blue dot' });
  const saved2 = await worker.handleRequest(call('POST', '/api/assets', { entry: blue, png: PNG, thumb: PNG }, 'test-token'), env);
  ok(saved2.status === 200, 'a second save is stored (' + saved2.status + ')');
  const both = JSON.parse(await (await worker.handleRequest(call('GET', '/assets/catalog.json'), env)).text());
  ok(both.assets.length === 2 && both.assets.some(a => a.id === 'library.items.red-dot') && both.assets.some(a => a.id === 'library.items.blue-dot'), 'two sequential saves both remain');
  const patched = await worker.handleRequest(call('PATCH', '/api/assets/library.items.red-dot', { name: 'Crimson dot', category: 'decor' }, 'test-token'), env);
  ok(patched.status === 200 && cat.assets[0].id === 'library.items.red-dot', 'a rename keeps the id');
  const after = JSON.parse(await (await worker.handleRequest(call('GET', '/assets/catalog.json'), env)).text());
  ok(after.assets[0].name === 'Crimson dot' && after.assets[0].category === 'decor' && after.assets[0].files.png === 'png/library.items.red-dot.png', 'name and category change, the file stays');
  const missing = await worker.handleRequest(call('GET', '/assets/rooms/missing.svg'), env);
  ok(missing.status === 200 && (await missing.text()) === 'static', 'a missing library file falls through to the site');
  const bad = await worker.handleRequest(call('GET', '/assets/foo..bar'), env);
  ok(bad.status === 400, 'a path that climbs out of assets is refused');
  const huge = new Request('http://127.0.0.1/api/assets', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: ' '.repeat(2 * 1024 * 1024 + 1) });
  ok((await worker.handleRequest(huge, env)).status === 413, 'a body over 2 MB is refused');
  const old = bucket();
  old.map.set('catalog.json', { body: JSON.stringify({
    schema: 'cpa-catalog/1', pack: { id: 'library', name: 'Library', version: '1' },
    categories: [{ id: 'items', name: 'Items', icon: '🧸', order: 4 }], assets: []
  }), type: 'application/json' });
  const env2 = { LIBRARY: old, ASSET_WRITE_TOKEN: 'test-token', ASSETS: env.ASSETS };
  const listed = JSON.parse(await (await worker.handleRequest(call('GET', '/assets/catalog.json'), env2)).text());
  ok(listed.categories.some(c => c.id === 'characters') && listed.categories.some(c => c.id === 'clothing' && c.order === 6) && listed.assets.length === 0, 'an older library catalog gains Characters and Clothing');
  ok(JSON.parse(old.map.get('catalog.json').body).categories.some(c => c.id === 'clothing'), 'the merged catalog is written back');
  const bear = Object.assign({}, entry, { id: 'library.characters.bear', category: 'characters', name: 'Bear' });
  ok((await worker.handleRequest(call('POST', '/api/assets', { entry: bear, png: PNG, thumb: PNG }, 'test-token'), env2)).status === 200, 'a save in Characters is accepted');

  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome'), headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.extract && window.CST.assets && window.CST.assets.list().length === 5, { timeout: 8000 });
  await p.click('[data-tab=tabAssets]');
  const prep = await p.evaluate(() => {
    const w = 40, h = 40, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x - 20) * (x - 20) + (y - 20) * (y - 20) <= 36) { const i = (y * w + x) * 4; data[i] = 200; data[i + 1] = 20; data[i + 2] = 20; }
    }
    const out = window.CST.extract.prepare(data, w, h, { x: 0, y: 0, w: w, h: h }, true);
    const row = window.CST.extract.entry({ name: 'Red dot', category: 'items', pxW: out.w, pxH: out.h, hasAlpha: out.hasAlpha, added: '2026-11-27' });
    const errs = window.CST.assets.validateCatalog({
      schema: 'cpa-catalog/1', pack: { id: 'library', name: 'Library', version: '1.0.0', license: 'CC0-1.0' },
      categories: [{ id: 'items', name: 'Items', order: 4 }], assets: [row]
    }, { publicRepo: true });
    window.CST.extract_ui.loadPixels(data, w, h);
    window.CST.extract_ui.setBox({ x: 0, y: 0, w: w, h: h });
    return { w: out.w, h: out.h, flat: out.flat, hasAlpha: out.hasAlpha, errs: errs.map(e => e.path + ' ' + e.msg), id: row.id };
  });
  ok(prep.flat && prep.hasAlpha && prep.w < 30 && prep.h < 30 && prep.w > 8, 'knockout trims the white page away (' + prep.w + '×' + prep.h + ')');
  ok(!prep.errs.length && prep.id === 'library.items.red-dot', 'the catalog entry is valid (' + prep.errs.join('; ') + ')');
  await p.evaluate(() => {
    document.querySelector('#extractName').value = 'Red dot';
    document.querySelector('#extractCat').value = 'items';
    document.querySelector('#extractToken').value = 'test-token';
    const orig = window.fetch.bind(window);
    window.__posts = [];
    window.fetch = (url, opt) => {
      if (String(url).includes('/api/assets') && opt && opt.method === 'POST') {
        window.__posts.push(JSON.parse(opt.body));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return orig(url, opt);
    };
  });
  const before = await p.evaluate(() => window.CST.items.length);
  await p.click('#extractSave');
  await p.waitForFunction(() => window.__posts && window.__posts.length === 1, { timeout: 4000 });
  const posted = await p.evaluate(() => {
    const body = window.__posts[0];
    return { name: body.entry.name, category: body.entry.category, png: body.png.slice(0, 22), thumb: body.thumb.slice(0, 22), n: window.CST.items.length, msg: document.querySelector('#extractMsg').textContent };
  });
  ok(posted.name === 'Red dot' && posted.category === 'items' && posted.png === 'data:image/png;base64,' && posted.thumb === 'data:image/png;base64,', 'the save posts the PNG, thumb, name, and category');
  ok(before === 0 && posted.n === 0 && /in the library/.test(posted.msg), 'saving does not add the sticker to the scene (' + posted.msg + ')');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
