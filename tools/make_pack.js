#!/usr/bin/env node
/* Turn a folder of finished pictures into a private .cpapack.zip.
   node tools/make_pack.js [folder] [--id packid] [--category characters] [--name "My stickers"]
   A subfolder named rooms, furniture, decor, items, or characters sets the category.
   Loose pictures, and any other folder, go to items unless --category is set.
   The zip is written in the folder as <id>.cpapack.zip. Import it with + Import pack. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const CATS = [
  { id: 'rooms', name: 'Rooms', icon: '🏠', order: 1 },
  { id: 'furniture', name: 'Furniture', icon: '🛋️', order: 2 },
  { id: 'decor', name: 'Decor', icon: '🖼️', order: 3 },
  { id: 'items', name: 'Items', icon: '🧸', order: 4 },
  { id: 'characters', name: 'Characters', icon: '🐻', order: 5 }
];
const KNOWN = new Set(CATS.map(c => c.id));
const EXT = new Set(['.png', '.jpg', '.jpeg']);

function packId(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  if (!s || s === 'core' || s === 'library') return 'stickers';
  return s;
}
function slug(stem) {
  const s = String(stem || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return s || 'sticker';
}
function pretty(stem) {
  const s = String(stem || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || 'Sticker').slice(0, 40);
}
function sizeIn(pxW, pxH) {
  let w = pxW >= pxH ? 2 : 2 * pxW / pxH;
  let h = pxW >= pxH ? 2 * pxH / pxW : 2;
  let k = Math.min(1, 11 / w, 11 / h);
  w *= k; h *= k;
  k = Math.max(1, 0.25 / w, 0.25 / h);
  w *= k; h *= k;
  if (w > 11 || h > 11) { k = Math.min(11 / w, 11 / h); w *= k; h *= k; }
  const r = (n) => Math.round(n * 1000) / 1000;
  return { w: r(w), h: r(h) };
}
function pngSize(buf) {
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), alpha: buf[25] === 4 || buf[25] === 6 };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let o = 2;
  while (o + 8 < buf.length) {
    if (buf[o] !== 0xff) return null;
    const m = buf[o + 1];
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5), alpha: false };
    if (m === 0xd9 || m === 0xda) return null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { o += 2; continue; }
    const len = buf.readUInt16BE(o + 2);
    if (len < 2) return null;
    o += 2 + len;
  }
  return null;
}
function imageSize(buf, ext) {
  if (ext === '.png') return pngSize(buf);
  if (ext === '.jpg' || ext === '.jpeg') return jpegSize(buf);
  return null;
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameB = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameB.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameB); offset += local.length + nameB.length + comp.length;
  }
  const cenbuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cenbuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenbuf, end]);
}
function walk(dir, rel) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    const next = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...walk(abs, next));
    else if (EXT.has(path.extname(ent.name).toLowerCase()) && !/\.cpapack\.zip$/i.test(ent.name)) out.push({ abs, rel: next });
  }
  return out;
}
function categoryFor(rel, forced) {
  if (forced) return forced;
  const top = rel.split('/')[0];
  if (rel.includes('/') && KNOWN.has(top)) return top;
  return 'items';
}
async function chromeThumbs(rows) {
  let puppeteer;
  try { puppeteer = require(path.join(__dirname, '..', 'test', 'node_modules', 'puppeteer-core')); }
  catch (e) { return null; }
  const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
  if (!fs.existsSync(chrome)) return null;
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const made = {};
    for (const row of rows) {
      const url = 'data:' + (row.ext === '.png' ? 'image/png' : 'image/jpeg') + ';base64,' + row.buf.toString('base64');
      const webp = await page.evaluate(async (src) => {
        const im = new Image(); im.src = src; await im.decode();
        const k = 256 / Math.max(im.naturalWidth, im.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', 0.8);
      }, url);
      made[row.id] = Buffer.from(webp.split(',')[1], 'base64');
    }
    return made;
  } catch (e) { return null; }
  finally { if (browser) await browser.close(); }
}
async function buildPack(folder, opt) {
  opt = opt || {};
  const root = path.resolve(folder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Not a folder: ' + folder);
  if (opt.category && !KNOWN.has(opt.category)) throw new Error('--category must be ' + [...KNOWN].join(', '));
  const id = packId(opt.id || path.basename(root));
  const warnings = [];
  if (opt.id && packId(opt.id) !== String(opt.id).toLowerCase().replace(/[^a-z0-9]/g, '')) warnings.push('pack id became ' + id);
  const pictures = walk(root, '').sort((a, b) => a.rel.localeCompare(b.rel));
  if (!pictures.length) throw new Error('No PNG or JPG files in ' + root);
  const used = new Set(), assets = [], rows = [];
  const added = new Date().toISOString().slice(0, 10);
  for (const pic of pictures) {
    const ext = path.extname(pic.rel).toLowerCase();
    const buf = fs.readFileSync(pic.abs);
    const dim = imageSize(buf, ext);
    if (!dim || !(dim.w > 0 && dim.h > 0)) { warnings.push('skipped ' + pic.rel + ' (could not read the size)'); continue; }
    if (buf.length > 1.5e6) warnings.push(pic.rel + ' is ' + buf.length + ' bytes (over 1.5 MB)');
    const stem = path.basename(pic.rel, path.extname(pic.rel));
    const category = categoryFor(pic.rel, opt.category);
    let base = slug(stem), n = 2;
    let assetId = id + '.' + category + '.' + base;
    while (used.has(assetId)) { assetId = id + '.' + category + '.' + base + '-' + n; n++; }
    used.add(assetId);
    const shape = dim.alpha ? 'contour' : 'rect';
    assets.push({
      id: assetId, name: pretty(stem), category, tags: [],
      size: sizeIn(dim.w, dim.h),
      files: { png: pic.rel, thumb: pic.rel },
      cut: { shape, offset: shape === 'contour' ? 0.04 : 0 },
      license: 'LicenseRef-Private', author: 'private', source: 'original', added
    });
    rows.push({ id: assetId, rel: pic.rel, buf, ext });
  }
  if (!assets.length) throw new Error('No readable PNG or JPG files in ' + root);
  let thumbs = null;
  if (opt.thumbs !== 'source') thumbs = await chromeThumbs(rows);
  const files = {};
  rows.forEach(row => { files[row.rel] = row.buf; });
  if (thumbs) {
    assets.forEach(a => {
      if (!thumbs[a.id]) return;
      const rel = 'thumbs/' + a.id + '.webp';
      a.files.thumb = rel;
      files[rel] = thumbs[a.id];
    });
  }
  const have = new Set(assets.map(a => a.category));
  const catalog = {
    schema: 'cpa-catalog/1',
    pack: { id, name: opt.name || path.basename(root), version: '1.0.0', license: 'LicenseRef-Private', author: 'private' },
    categories: CATS.filter(c => have.has(c.id)),
    assets
  };
  files['pack.json'] = Buffer.from(JSON.stringify(catalog));
  const zipBuf = zip(files);
  const outPath = path.join(root, id + '.cpapack.zip');
  if (opt.write !== false) fs.writeFileSync(outPath, zipBuf);
  return { catalog, files, zip: zipBuf, outPath, warnings };
}
function parseArgs(argv) {
  const out = { folder: process.cwd(), id: null, category: null, name: null, thumbs: 'auto' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i];
    else if (a === '--category') out.category = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--thumbs') out.thumbs = argv[++i];
    else if (!a.startsWith('--')) out.folder = a;
  }
  return out;
}
module.exports = { buildPack, packId, slug, pretty, sizeIn, imageSize, zip, CATS };
if (require.main === module) {
  const opt = parseArgs(process.argv);
  buildPack(opt.folder, opt).then(built => {
    built.warnings.forEach(w => console.warn('warning: ' + w));
    console.log('Wrote ' + built.outPath + ' (' + built.catalog.assets.length + ' pictures)');
  }).catch(e => { console.error(e.message || e); process.exit(1); });
}
