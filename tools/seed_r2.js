#!/usr/bin/env node
/* Copy the starter catalog into the library bucket. Dry-run unless --put. */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'cricut-print-assistant-library';

function buildLibraryCatalog(root) {
  const dir = path.join(root, 'assets');
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
  catalog.pack = {
    id: 'library', name: 'Library', version: catalog.pack.version || '1.0.0',
    license: 'CC0-1.0', author: 'Cricut Print Assistant contributors'
  };
  const files = [{ key: 'catalog.json', abs: null }];
  (catalog.assets || []).forEach(a => {
    if (a.id.startsWith('core.')) a.id = 'library.' + a.id.slice('core.'.length);
    if (!a.id.startsWith('library.')) throw new Error('cannot rewrite id ' + a.id);
    ['svg', 'png', 'thumb'].forEach(k => { if (a.files && a.files[k]) files.push({ key: a.files[k], abs: path.join(dir, a.files[k]) }); });
    Object.values((a.files && a.files.masks) || {}).forEach(rel => files.push({ key: rel, abs: path.join(dir, rel) }));
  });
  files.forEach(f => { if (f.abs && !fs.existsSync(f.abs)) throw new Error('missing ' + f.key); });
  return { catalog, files };
}

function main() {
  const built = buildLibraryCatalog(ROOT);
  const put = process.argv.includes('--put');
  console.log((put ? 'uploading ' : 'would upload ') + built.files.length + ' objects to ' + BUCKET);
  if (!put) return;
  const tmp = path.join(ROOT, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const catPath = path.join(tmp, 'library-catalog.json');
  fs.writeFileSync(catPath, JSON.stringify(built.catalog, null, 2));
  const jobs = built.files.map(f => ({ key: f.key, file: f.abs || catPath }));
  for (const job of jobs) {
    const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', BUCKET + '/' + job.key, '--file=' + job.file, '--remote'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status) process.exit(r.status);
  }
}

module.exports = { buildLibraryCatalog, BUCKET };
if (require.main === module) main();
