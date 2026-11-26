// P2·M5: a private pack zip stays in IndexedDB and is never a repo file.
const puppeteer = require('puppeteer-core'), path = require('path'), zlib = require('zlib'), { spawn, execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
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
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  let listed = '';
  try { listed = execFileSync('git', ['ls-files'], { cwd: R, encoding: 'utf8' }); } catch (e) { listed = ''; }
  ok(!/cpapack|private\//.test(listed), 'git does not track a private pack');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g data-region="ink" fill="#112233"><circle cx="50" cy="50" r="40"/></g></svg>';
  const catalog = { schema: 'cpa-catalog/1', pack: { id: 'mine', name: 'Mine', version: '1', license: 'LicenseRef-Private' }, categories: [{ id: 'items', name: 'Items', order: 1 }],
    assets: [{ id: 'mine.items.star', name: 'Star', category: 'items', size: { w: 1, h: 1 }, files: { svg: 'star.svg', thumb: 'star.webp' }, cut: { shape: 'contour', offset: 0 }, regions: [{ id: 'ink', name: 'Ink', default: '#112233' }], license: 'LicenseRef-Private', author: 'Owner', source: 'original', added: '2026-11-26' }] };
  const buf = zip({ 'pack.json': Buffer.from(JSON.stringify(catalog)), 'star.svg': Buffer.from(svg), 'star.webp': Buffer.from('webp') });
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets, { timeout: 8000 });
  const out = await p.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await window.CST.assets_ui.importPack(new File([bytes], 'mine.cpapack.zip', { type: 'application/zip' }));
    const a = window.CST.assets.get('mine.items.star');
    return { name: a && a.name, license: a && a.license, packs: window.CST.assets.packs.filter(x => x.src === 'pack').length };
  }, buf.toString('base64'));
  ok(out.name === 'Star' && out.license === 'LicenseRef-Private' && out.packs === 1, 'a private zip imports and is badged as private');
  const again = await p.evaluate(async () => { await new Promise(r => setTimeout(r, 50)); return !!window.CST.assets.get('mine.items.star'); });
  ok(again, 'the pack is still there after import');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
