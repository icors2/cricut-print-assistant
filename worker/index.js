/* Serves the sticker library from R2 and accepts token-gated writes. */
const MAX = 2 * 1024 * 1024;
const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+){2}$/;
const CATEGORIES = [
  { id: 'rooms', name: 'Rooms', icon: '🏠', order: 1 },
  { id: 'furniture', name: 'Furniture', icon: '🛋️', order: 2 },
  { id: 'decor', name: 'Decor', icon: '🖼️', order: 3 },
  { id: 'items', name: 'Items', icon: '🧸', order: 4 },
  { id: 'characters', name: 'Characters', icon: '🐻', order: 5 }
];

function ensureCategories(cat) {
  if (!cat.categories) cat.categories = [];
  const have = new Set(cat.categories.map(c => c && c.id));
  let added = false;
  for (const c of CATEGORIES) if (!have.has(c.id)) { cat.categories.push(Object.assign({}, c)); added = true; }
  return added;
}

function emptyCatalog() {
  return {
    schema: 'cpa-catalog/1',
    pack: { id: 'library', name: 'Library', version: '1.0.0', license: 'CC0-1.0', author: 'Cricut Print Assistant contributors' },
    categories: CATEGORIES.map(c => Object.assign({}, c)),
    assets: []
  };
}

function json(status, body, extra) {
  const headers = Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra || {});
  return new Response(JSON.stringify(body), { status, headers });
}

function validateEntry(entry, categories) {
  const err = [];
  const cats = new Set((categories || CATEGORIES).map(c => c.id));
  if (!entry || typeof entry !== 'object') { err.push('entry is required'); return err; }
  if (!ID_RE.test(entry.id || '') || !String(entry.id).startsWith('library.')) err.push('id must be library.category.slug');
  const mid = String(entry.id || '').split('.')[1];
  if (!cats.has(entry.category) || mid !== entry.category) err.push('unknown category');
  if (!entry.name || String(entry.name).length > 40) err.push('name must be 1-40 characters');
  const s = entry.size || {};
  if (!(s.w >= 0.25 && s.w <= 11 && s.h >= 0.25 && s.h <= 11)) err.push('size must be 0.25-11 inches');
  if (!entry.cut || !['contour', 'rect', 'rounded'].includes(entry.cut.shape)) err.push('cut shape must be contour, rect, or rounded');
  if (entry.license !== 'CC0-1.0') err.push('license must be CC0-1.0');
  if (entry.source !== 'original') err.push('source must be original');
  if (!entry.author || String(entry.author).length > 80 || String(entry.author).includes('@')) err.push('author is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.added || '')) err.push('added must be a date');
  return err;
}

function cleanEntry(entry) {
  const id = entry.id;
  return {
    id, name: String(entry.name).trim(), category: entry.category,
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 12) : [],
    size: { w: +entry.size.w, h: +entry.size.h },
    files: { png: 'png/' + id + '.png', thumb: 'thumbs/' + id + '.png' },
    cut: { shape: entry.cut.shape, offset: Math.max(0, +entry.cut.offset || 0) },
    license: 'CC0-1.0', author: entry.author, source: 'original', added: entry.added
  };
}

function decodePng(url) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(url || '');
  if (!m) return null;
  const bin = atob(m[1].replace(/\s/g, ''));
  if (bin.length > MAX) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length < 8 || out[0] !== 0x89 || out[1] !== 0x50 || out[2] !== 0x4e || out[3] !== 0x47) return null;
  return out;
}

async function sameToken(got, want) {
  if (!want || !got) return false;
  const enc = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(got)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(want)));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : '';
}

async function authorized(request, env) {
  return sameToken(bearer(request), env.ASSET_WRITE_TOKEN || '');
}

async function starterFromAssets(env, request) {
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/assets/catalog.json', request.url)));
    if (!res.ok) return emptyCatalog();
    const cat = await res.json();
    if (!cat || cat.schema !== 'cpa-catalog/1') return emptyCatalog();
    cat.pack = {
      id: 'library', name: 'Library', version: (cat.pack && cat.pack.version) || '1.0.0',
      license: 'CC0-1.0', author: 'Cricut Print Assistant contributors'
    };
    (cat.assets || []).forEach(a => { if (String(a.id || '').startsWith('core.')) a.id = 'library.' + a.id.slice(5); });
    if (!cat.categories || !cat.categories.length) cat.categories = CATEGORIES.map(c => Object.assign({}, c));
    ensureCategories(cat);
    return cat;
  } catch (e) { return emptyCatalog(); }
}

async function readCatalog(env, request) {
  const obj = await env.LIBRARY.get('catalog.json');
  if (obj) {
    try {
      const cat = JSON.parse(await obj.text());
      if (cat && cat.schema === 'cpa-catalog/1' && cat.pack && cat.pack.id === 'library') {
        if (ensureCategories(cat)) await writeCatalog(env.LIBRARY, cat);
        return cat;
      }
    } catch (e) { /* replace an unreadable catalog */ }
  }
  return starterFromAssets(env, request);
}

async function writeCatalog(bucket, catalog) {
  await bucket.put('catalog.json', JSON.stringify(catalog), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-cache' } });
}

function typeFor(key) {
  if (key.endsWith('.json')) return 'application/json; charset=utf-8';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function readBody(request) {
  const n = +(request.headers.get('content-length') || 0);
  if (n > MAX) return { error: json(413, { error: 'Too large' }) };
  const text = await request.text();
  if (text.length > MAX) return { error: json(413, { error: 'Too large' }) };
  try { return { body: JSON.parse(text) }; }
  catch (e) { return { error: json(400, { error: 'Expected JSON' }) }; }
}

async function postAsset(request, env) {
  if (!(await authorized(request, env))) return json(401, { error: 'Unauthorized' });
  const got = await readBody(request);
  if (got.error) return got.error;
  const entry = got.body.entry;
  const catalog = await readCatalog(env, request);
  if (!catalog || catalog.schema !== 'cpa-catalog/1' || !catalog.pack || catalog.pack.id !== 'library') return json(409, { error: 'The library catalog is not ready' });
  const errs = validateEntry(entry, catalog.categories);
  if (errs.length) return json(400, { error: errs.join('; ') });
  const row = cleanEntry(entry);
  if ((catalog.assets || []).some(a => a.id === row.id)) return json(409, { error: 'That sticker is already in the library' });
  const png = decodePng(got.body.png), thumb = decodePng(got.body.thumb);
  if (!png || !thumb) return json(400, { error: 'png and thumb must be PNG data URLs' });
  await env.LIBRARY.put(row.files.png, png, { httpMetadata: { contentType: 'image/png' } });
  await env.LIBRARY.put(row.files.thumb, thumb, { httpMetadata: { contentType: 'image/png' } });
  catalog.assets = (catalog.assets || []).concat([row]);
  await writeCatalog(env.LIBRARY, catalog);
  return json(200, { ok: true, id: row.id });
}

async function patchAsset(request, env, id) {
  if (!(await authorized(request, env))) return json(401, { error: 'Unauthorized' });
  if (!ID_RE.test(id)) return json(400, { error: 'bad id' });
  const got = await readBody(request);
  if (got.error) return got.error;
  const catalog = await readCatalog(env, request);
  const row = (catalog.assets || []).find(a => a.id === id);
  if (!row) return json(404, { error: 'No such sticker' });
  const name = got.body.name != null ? String(got.body.name).trim() : row.name;
  const category = got.body.category != null ? got.body.category : row.category;
  const cats = new Set((catalog.categories || []).map(c => c.id));
  if (!name || name.length > 40) return json(400, { error: 'name must be 1-40 characters' });
  if (!cats.has(category)) return json(400, { error: 'unknown category' });
  row.name = name;
  row.category = category;
  await writeCatalog(env.LIBRARY, catalog);
  return json(200, { ok: true, id });
}

function assetKey(pathname) {
  if (!pathname.startsWith('/assets/')) return null;
  let key = '';
  try { key = decodeURIComponent(pathname.slice('/assets/'.length)); }
  catch (e) { return ''; }
  if (!key || key.includes('..') || key.includes('\\') || key.startsWith('/')) return '';
  return key;
}

async function getAsset(request, env, key) {
  const obj = await env.LIBRARY.get(key);
  if (!obj) return env.ASSETS.fetch(request);
  if (key === 'catalog.json') {
    let cat = null;
    try { cat = JSON.parse(await obj.text()); } catch (e) {}
    if (cat && cat.schema === 'cpa-catalog/1' && cat.pack && cat.pack.id === 'library') {
      if (ensureCategories(cat)) await writeCatalog(env.LIBRARY, cat);
      return json(200, cat, { 'cache-control': 'no-cache' });
    }
    const again = await env.LIBRARY.get(key);
    if (!again) return env.ASSETS.fetch(request);
    const headers = new Headers();
    if (again.writeHttpMetadata) again.writeHttpMetadata(headers);
    if (again.httpEtag) headers.set('etag', again.httpEtag);
    if (!headers.has('content-type')) headers.set('content-type', typeFor(key));
    headers.set('cache-control', 'no-cache');
    return new Response(again.body, { headers });
  }
  const headers = new Headers();
  if (obj.writeHttpMetadata) obj.writeHttpMetadata(headers);
  if (obj.httpEtag) headers.set('etag', obj.httpEtag);
  if (!headers.has('content-type')) headers.set('content-type', typeFor(key));
  return new Response(obj.body, { headers });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/assets' && request.method === 'POST') return postAsset(request, env);
  if (request.method === 'PATCH' && url.pathname.startsWith('/api/assets/')) return patchAsset(request, env, decodeURIComponent(url.pathname.slice('/api/assets/'.length)));
  if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found' });
  const key = assetKey(url.pathname);
  if (key === '') return json(400, { error: 'Bad asset path' });
  if (key) return getAsset(request, env, key);
  return env.ASSETS.fetch(request);
}

export { validateEntry, cleanEntry, emptyCatalog, decodePng, handleRequest, CATEGORIES, ensureCategories };

export default { fetch: (request, env) => handleRequest(request, env) };
