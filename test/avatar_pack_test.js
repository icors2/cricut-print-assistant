// Avatar parts from a private pack: loader merge, per-template scaling, follows, palettes, presets, export,
// and tools/build_assets.js --private. The fixture is made-up shapes built here, never real pack art.
const puppeteer = require('puppeteer-core'), path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib'), { spawn, spawnSync } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameB = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data), local = Buffer.alloc(30);
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
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
// A 200 × 300 artboard (not the core 1000 × 1500) so the mapping is exercised.
const S = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">' + body + '</svg>';
const L = { license: 'LicenseRef-Private', author: 'Test', source: 'original' };
const parts = {
  schema: 'cpa-avatar/1', pack: 'tpk',
  template: { id: 'tiny-v1', viewBox: [0, 0, 200, 300], sizeIn: { w: 2, h: 3 }, anchors: { head: [100, 80], neck: [100, 120] } },
  slots: [{ id: 'hairBack', name: 'Hair (back)', z: 10, optional: true }, { id: 'body', name: 'Body', z: 20, required: true }, { id: 'top', name: 'Top', z: 40, optional: true },
    { id: 'face', name: 'Face', z: 50, required: true }, { id: 'eyes', name: 'Eyes', z: 55, required: true }, { id: 'mouth', name: 'Mouth', z: 56, required: true }, { id: 'hat', name: 'Hat', z: 70, optional: true }],
  colorSlots: { skin: { name: 'Skin', palette: 'tpkskin', default: '#aa8866', regions: ['skin'] }, fur: { name: 'Fur', palette: 'tpkfur', default: '#776655', regions: ['fur'] } },
  parts: [
    Object.assign({ id: 'tpk.avatar.body-a', slot: 'body', name: 'Blob A', file: 'body/a.svg', regions: ['skin'] }, L),
    Object.assign({ id: 'tpk.avatar.body-tall', slot: 'body', name: 'Blob tall', file: 'body/tall.svg', regions: ['skin'], anchors: { head: [100, 60] } }, L),
    Object.assign({ id: 'tpk.avatar.face-a', slot: 'face', name: 'Face A', file: 'face/a.svg', regions: ['skin'], follows: 'head' }, L),
    Object.assign({ id: 'tpk.avatar.eyes-a', slot: 'eyes', name: 'Dots', file: 'eyes/a.svg', regions: [], follows: 'head' }, L),
    Object.assign({ id: 'tpk.avatar.mouth-a', slot: 'mouth', name: 'Line', file: 'mouth/a.svg', regions: [], follows: 'head' }, L),
    Object.assign({ id: 'tpk.avatar.top-a', slot: 'top', name: 'Tee', file: 'top/a.svg', regions: ['cloth'] }, L),
    Object.assign({ id: 'tpk.avatar.hat-a', slot: 'hat', name: 'Cap', file: 'hat/a.svg', regions: ['fur'], follows: 'head' }, L)
  ],
  presets: [
    { id: 'preset-sunny', name: 'Tiny Tess', parts: { body: 'tpk.avatar.body-a', face: 'tpk.avatar.face-a', eyes: 'tpk.avatar.eyes-a', mouth: 'tpk.avatar.mouth-a', top: 'tpk.avatar.top-a', hat: 'tpk.avatar.hat-a' }, colors: { skin: '#bb9977' } }
  ]
};
const files = {
  'body/a.svg': S('<g data-region="skin" fill="#aa8866"><rect x="60" y="110" width="80" height="170" rx="30"/></g>'),
  'body/tall.svg': S('<g data-region="skin" fill="#aa8866"><rect x="60" y="90" width="80" height="190" rx="30"/></g>'),
  'face/a.svg': S('<g data-region="skin" fill="#aa8866"><circle cx="100" cy="80" r="40"/></g>'),
  'eyes/a.svg': S('<circle cx="88" cy="78" r="4" fill="#222222"/><circle cx="112" cy="78" r="4" fill="#222222"/>'),
  'mouth/a.svg': S('<rect x="92" y="94" width="16" height="3" fill="#663333"/>'),
  'top/a.svg': S('<g data-region="cloth" fill="#3366aa"><rect x="58" y="125" width="84" height="70" rx="10"/></g>'),
  'hat/a.svg': S('<g data-region="fur" fill="#776655"><rect x="65" y="36" width="70" height="20" rx="8"/></g>')
};
const catalog = { schema: 'cpa-catalog/1', pack: { id: 'tpk', name: 'Test avatar pack', version: '1', license: 'LicenseRef-Private' }, categories: [], assets: [], avatar: 'avatar/parts.json' };
const palettes = { schema: 'cpa-palettes/1', palettes: [{ id: 'tpkskin', name: 'Skin', colors: ['#bb9977', '#553322'] }, { id: 'tpkfur', name: 'Fur', colors: ['#776655', '#ddccbb'] }] };
const zipFiles = { 'pack.json': Buffer.from(JSON.stringify(catalog)), 'avatar/parts.json': Buffer.from(JSON.stringify(parts)), 'avatar/palettes.json': Buffer.from(JSON.stringify(palettes)) };
for (const [k, v] of Object.entries(files)) zipFiles['avatar/' + k] = Buffer.from(v);
const badParts = JSON.parse(JSON.stringify(parts)); badParts.template.viewBox = [0, 0, 0, 300];
const badZip = zip({ 'pack.json': Buffer.from(JSON.stringify(Object.assign({}, catalog, { pack: Object.assign({}, catalog.pack, { id: 'tpkbad' }) }))), 'avatar/parts.json': Buffer.from(JSON.stringify(badParts)) });

(async () => {
  // build_assets.js --private: a private folder passes only with the flag, and the flag is refused inside the repo.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-avpack-'));
  fs.mkdirSync(path.join(tmp, 'avatar'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'pack.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(tmp, 'avatar', 'parts.json'), JSON.stringify(parts));
  for (const [k, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(tmp, 'avatar', k)), { recursive: true }); fs.writeFileSync(path.join(tmp, 'avatar', k), v); }
  const tool = path.join(R, 'tools', 'build_assets.js');
  const priv = spawnSync(process.execPath, [tool, '--check', '--private', '--root', tmp], { encoding: 'utf8' });
  ok(priv.status === 0, '--private accepts a LicenseRef-Private avatar pack (' + (priv.stdout + priv.stderr).trim().split('\n').pop() + ')');
  fs.copyFileSync(path.join(tmp, 'pack.json'), path.join(tmp, 'catalog.json'));
  const pub = spawnSync(process.execPath, [tool, '--check', '--root', tmp], { encoding: 'utf8' });
  ok(pub.status !== 0 && /must be CC0-1.0/.test(pub.stderr), 'without --private the same pack is rejected');
  const inRepo = spawnSync(process.execPath, [tool, '--check', '--private', '--root', path.join(R, 'assets')], { encoding: 'utf8' });
  ok(inRepo.status === 2, '--private refuses the public assets folder');
  fs.writeFileSync(path.join(tmp, 'avatar', 'hat', 'a.svg'), files['hat/a.svg'].replace('0 0 200 300', '0 0 600 900'));
  const vb = spawnSync(process.execPath, [tool, '--check', '--private', '--root', tmp], { encoding: 'utf8' });
  ok(vb.status !== 0 && /≠ template/.test(vb.stderr), 'a part on the wrong artboard is caught');
  fs.rmSync(tmp, { recursive: true, force: true });

  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.avatarParts() && window.CST.assets_ui, { timeout: 8000 });
  const toFile = async (b64, name) => p.evaluate(async (b64, name) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { await window.CST.assets_ui.importPack(new File([bytes], name, { type: 'application/zip' })); return 'ok'; } catch (e) { return 'err: ' + e.message; }
  }, b64, name);
  ok(/^err: avatar template\.viewBox/.test(await toFile(badZip.toString('base64'), 'tpkbad.cpapack.zip')), 'a pack with a broken avatar parts.json is refused on import');
  ok(await toFile(zip(zipFiles).toString('base64'), 'tpk.cpapack.zip') === 'ok', 'an avatar-only private pack imports');
  const r = await p.evaluate(async () => {
    const C = window.CST, M = C.assets.avatarParts();
    const ids = M.parts.map(x => x.id), pres = M.presets.map(x => x.id);
    const pr = M.presets.find(x => x.pack === 'tpk');
    const spec = { schema: 'cpa-avatar-spec/1', template: 'tiny-v1', parts: pr.parts, colors: pr.colors };
    const svg = await C.avatar.compose(spec);
    const tall = Object.assign({}, spec, { parts: Object.assign({}, spec.parts, { body: 'tpk.avatar.body-tall' }) });
    const svgTall = await C.avatar.compose(tall);
    const hatOff = C.avatar.followOffset(M.parts.find(x => x.id === 'tpk.avatar.hat-a'), tall, C.avatar.outTemplate(tall));
    const topOff = C.avatar.followOffset(M.parts.find(x => x.id === 'tpk.avatar.top-a'), tall, C.avatar.outTemplate(tall));
    // Core face on a pack body: drawn on 1000 × 1500, mapped onto the 200 × 300 body artboard.
    const mixed = Object.assign({}, spec, { parts: Object.assign({}, spec.parts, { face: 'core.avatar.face-round' }) });
    const svgMixed = await C.avatar.compose(mixed);
    const coreSvg = await C.avatar.compose({ parts: { body: 'core.avatar.body-01', face: 'core.avatar.face-round', eyes: 'core.avatar.eyes-happy', mouth: 'core.avatar.mouth-smile' } });
    const pal = C.assets.palettes().find(x => x.id === 'tpkskin');
    const pk = C.assets.packs.find(x => x.id === 'tpk');
    return { ids, pres, svg, svgTall, hatOff, topOff, svgMixed, coreSvg, pal: pal && pal.colors, avCount: pk && pk.avatarParts, presetName: pr.name };
  });
  ok(r.ids.includes('tpk.avatar.body-a') && r.ids.includes('core.avatar.body-01'), 'pack parts merge with the core parts');
  ok(r.pres[0] === 'preset-sunny' && r.pres.includes('core:preset-sunny'), 'pack presets come first and a clashing core preset id is namespaced');
  ok(/viewBox="0 0 200 300"/.test(r.svg) && /width="2in" height="3in"/.test(r.svg) && r.svg.includes('fill="#bb9977"'), 'a pack preset composes on its own 200×300 artboard with its colours');
  ok(!/data-part="tpk.avatar.hat-a" transform/.test(r.svg), 'follows on the template body does not move the hat');
  ok(r.hatOff[0] === 0 && r.hatOff[1] === -20 && /data-part="tpk.avatar.hat-a" transform="translate\(0 -20\)"/.test(r.svgTall), 'follows shifts the hat by the body anchor − template anchor (' + r.hatOff + ')');
  ok(r.topOff[0] === 0 && r.topOff[1] === 0, 'parts without follows stay where they were drawn');
  ok(/data-part="core.avatar.face-round" transform="[^"]*scale\(0\.2 0\.2\)/.test(r.svgMixed), 'a 1000×1500 core part is scaled onto the pack artboard');
  ok(/viewBox="0 0 1000 1500"/.test(r.coreSvg) && !/transform=/.test(r.coreSvg), 'the core avatar is 1000×1500 with no transforms');
  ok(r.pal && r.pal.includes('#553322'), 'pack palettes are merged');
  ok(r.avCount === 7, 'the pack lists its avatar parts (' + r.avCount + ')');

  // The Avatar tab stays hidden, so the builder screen is not mounted. Composition is checked above.
  await p.reload();
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.avatarParts() && window.CST.assets.avatarParts().parts.some(x => x._pack === 'tpk'), { timeout: 8000 }).catch(() => {});
  ok(await p.evaluate(() => !!(window.CST.assets.avatarParts() || { parts: [] }).parts.find(x => x.id === 'tpk.avatar.hat-a')), 'pack avatar parts come back from IndexedDB after a reload');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
