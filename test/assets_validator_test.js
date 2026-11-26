// P2·M1: a broken catalog must fail tools/build_assets.js, each for its own reason.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), TOOL = path.join(R, 'tools', 'build_assets.js');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-region="a" fill="#112233"><rect width="100" height="100"/></g></svg>';
function run(dir) {
  try { return execFileSync(process.execPath, [TOOL, '--check', '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
function fixture(name, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-' + name + '-'));
  fs.writeFileSync(path.join(dir, 'mark.svg'), SVG);
  fs.writeFileSync(path.join(dir, 'thumb.webp'), Buffer.from('webp'));
  const cat = { schema: 'cpa-catalog/1', pack: { id: 'core', name: 'T', version: '0.0.1' }, categories: [{ id: 'items', name: 'Items', order: 1 }],
    assets: [{ id: 'core.items.mark', name: 'Mark', category: 'items', size: { w: 1, h: 1 }, files: { svg: 'mark.svg', thumb: 'thumb.webp' }, cut: { shape: 'contour', offset: 0 }, regions: [{ id: 'a', name: 'A', default: '#112233' }], license: 'CC0-1.0', author: 'Cricut Print Assistant contributors', source: 'original', added: '2026-11-26' }] };
  mutate(cat, dir);
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(cat));
  return run(dir);
}
const missing = fixture('miss', (cat) => { cat.assets[0].files.svg = 'nope.svg'; });
ok(/missing file nope\.svg/.test(missing), 'missing file is its own error');
const dup = fixture('dup', (cat) => { cat.assets.push(JSON.parse(JSON.stringify(cat.assets[0]))); });
ok(/duplicate id/.test(dup), 'duplicate id is its own error');
const lic = fixture('lic', (cat) => { cat.assets[0].license = 'MIT'; });
ok(/CC0-1\.0/.test(lic), 'a public asset must be CC0');
const region = fixture('reg', (cat) => { cat.assets[0].regions[0].id = 'nope'; });
ok(/region "nope" not found/.test(region), 'a catalog region missing from the SVG fails');
const script = fixture('scr', (cat, dir) => { fs.writeFileSync(path.join(dir, 'mark.svg'), SVG.replace('<g', '<script></script><g')); });
ok(/forbidden construct/.test(script), 'a script in the SVG fails');
const aspect = fixture('asp', (cat) => { cat.assets[0].size = { w: 2, h: 1 }; });
ok(/aspect of viewBox/.test(aspect), 'a viewBox that does not match the catalog size fails');
const good = execFileSync(process.execPath, [TOOL, '--check'], { cwd: R, encoding: 'utf8' });
ok(/5 assets OK/.test(good), 'the placeholder catalog passes --check');
process.exit(fails ? 1 : 0);
