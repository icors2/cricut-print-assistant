#!/usr/bin/env node
/* Validate assets/ and render thumbnails in headless Chrome.
   Usage: node tools/build_assets.js [--check] [--root assets] */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const puppeteer = require(path.join(__dirname, '..', 'test', 'node_modules', 'puppeteer-core'));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg('--root') || path.join(__dirname, '..', 'assets')), CHECK = process.argv.includes('--check');
const BUDGET = { svg: 150e3, png: 1.5e6, thumb: 15e3, part: 40e3 };
const BAD_SVG = [/<script/i, /<foreignObject/i, /<style/i, /@import/i, /<image\b/i, /(xlink:)?href\s*=\s*"(?!#)/i];
const HEX = /^#[0-9a-f]{6}$/;

function loadValidator() {
  const api = {};
  const sandbox = {
    window: { CST: { registerModule: (n, a) => Object.assign(api, a), bus: { emit() {} } } },
    document: { getElementById: () => null, readyState: 'loading', addEventListener() {} },
    location: { protocol: 'file:' }, console, indexedDB: { open() { return { result: null }; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'assets.js'), 'utf8'), sandbox);
  return api.validateCatalog;
}
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

(async () => {
  const errors = [], warn = [], E = (p, m) => errors.push(p + ': ' + m);
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
  for (const e of loadValidator()(cat, { publicRepo: true, fileExists: exists })) {
    if (!CHECK && /\.files\.thumb$/.test(e.path) && /missing file/.test(e.msg)) continue;
    E(e.path, e.msg);
  }
  for (const a of cat.assets || []) {
    const src = a.files && (a.files.svg || a.files.png); if (!src || !exists(src)) continue;
    const buf = fs.readFileSync(path.join(ROOT, src)), kind = a.files.svg ? 'svg' : 'png';
    if (buf.length > BUDGET[kind]) E(a.id, kind + ' is ' + buf.length + ' bytes (budget ' + BUDGET[kind] + ')');
    if (kind === 'svg') {
      const t = buf.toString('utf8');
      for (const re of BAD_SVG) if (re.test(t)) E(a.id, 'SVG contains a forbidden construct ' + re);
      const regs = new Set([...t.matchAll(/data-region="([^"]+)"/g)].map(m => m[1]));
      for (const r of a.regions || []) if (!regs.has(r.id)) E(a.id, 'region "' + r.id + '" not found in the SVG');
      for (const r of regs) if (!(a.regions || []).some(x => x.id === r)) warn.push(a.id + ': data-region "' + r + '" isn\'t in the catalog');
      const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
      if (vb && Math.abs((+vb[2] / +vb[1]) / (a.size.h / a.size.w) - 1) > 0.01) E(a.id, 'aspect of viewBox ≠ catalog size');
    } else {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      if (Math.abs((h / w) / (a.size.h / a.size.w) - 1) > 0.01) E(a.id, 'aspect of PNG ≠ catalog size');
    }
    if (a.files.thumb && exists(a.files.thumb) && fs.statSync(path.join(ROOT, a.files.thumb)).size > BUDGET.thumb) E(a.id, 'thumbnail over ' + BUDGET.thumb + ' bytes');
  }
  const palPath = path.join(ROOT, 'palettes.json');
  if (fs.existsSync(palPath)) {
    const pal = JSON.parse(fs.readFileSync(palPath, 'utf8'));
    const ids = new Set();
    for (const p of pal.palettes || []) {
      if (!p.id || ids.has(p.id)) E('palettes.' + (p.id || '?'), 'missing or duplicate id');
      ids.add(p.id);
      for (const c of p.colors || []) if (!HEX.test(c)) E('palettes.' + p.id, 'bad colour ' + c);
    }
  }
  const partsPath = path.join(ROOT, 'avatar', 'parts.json');
  if (fs.existsSync(partsPath)) {
    const parts = JSON.parse(fs.readFileSync(partsPath, 'utf8'));
    const slots = new Set((parts.slots || []).map(s => s.id));
    for (const p of parts.parts || []) {
      if (!slots.has(p.slot)) E(p.id, 'unknown slot ' + p.slot);
      if (p.license !== 'CC0-1.0') E(p.id, 'public parts must be CC0-1.0');
      if (!p.file || !exists(p.file)) E(p.id, 'missing file ' + p.file);
      else {
        const buf = fs.readFileSync(path.join(ROOT, p.file));
        if (buf.length > BUDGET.part) E(p.id, 'part is ' + buf.length + ' bytes');
        const t = buf.toString('utf8');
        for (const re of BAD_SVG) if (re.test(t)) E(p.id, 'SVG contains a forbidden construct ' + re);
      }
    }
  }
  if (!CHECK && !errors.length) {
    const hashFile = path.join(ROOT, 'thumbs', '.hashes.json'), hashes = fs.existsSync(hashFile) ? JSON.parse(fs.readFileSync(hashFile, 'utf8')) : {};
    const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
    const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
    const page = await b.newPage();
    for (const a of cat.assets) {
      const src = path.join(ROOT, a.files.svg || a.files.png), hsh = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
      const out = path.join(ROOT, a.files.thumb);
      if (hashes[a.id] === hsh && fs.existsSync(out)) continue;
      const mime = a.files.svg ? 'image/svg+xml' : 'image/png', url = 'data:' + mime + ';base64,' + fs.readFileSync(src).toString('base64');
      const webp = await page.evaluate(async (url) => {
        const im = new Image(); im.src = url; await im.decode(); const k = 256 / Math.max(im.naturalWidth, im.naturalHeight);
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/webp', 0.8);
      }, url);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(webp.split(',')[1], 'base64'));
      hashes[a.id] = hsh;
    }
    fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 1) + '\n');
    await b.close();
    for (const a of cat.assets) {
      const out = path.join(ROOT, a.files.thumb);
      if (!fs.existsSync(out)) E(a.id, 'thumbnail was not written');
      else if (fs.statSync(out).size > BUDGET.thumb) E(a.id, 'thumbnail over ' + BUDGET.thumb + ' bytes');
    }
  }
  warn.forEach(w => console.warn('⚠ ' + w));
  if (errors.length) { errors.forEach(e => console.error('✗ ' + e)); process.exit(1); }
  console.log('✓ ' + cat.assets.length + ' assets OK' + (CHECK ? ' (check only)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
