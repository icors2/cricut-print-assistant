// Raster (PNG) avatar parts: per-body canvases at a dpi, body-specific clothing (`bodies`, `exclusive`),
// switching bodies, and export as one flattened contour sticker. Fixture PNGs are tiny made-up shapes.
const puppeteer = require('puppeteer-core'), path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib'), { spawn, spawnSync } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y); if (c) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; } }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
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
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
// Body "blob": 60×90 px at 30 dpi = 2×3 in. Body "tall": 40×80 px at 20 dpi = 2×4 in.
const files = {
  'bases/blob.png': png(60, 90, (x, y) => inBox(x, y, 15, 30, 45, 85) ? [200, 150, 100] : null),
  'blob/shirt.png': png(60, 90, (x, y) => inBox(x, y, 14, 50, 46, 70) ? [50, 100, 200] : null),
  'blob/hat.png': png(60, 90, (x, y) => inBox(x, y, 18, 12, 42, 34) ? [220, 60, 60] : null),   // sticks out above the body
  'blob/cup.png': png(60, 90, (x, y) => inBox(x, y, 40, 55, 50, 65) ? [240, 240, 240] : null),
  'bases/tall.png': png(40, 80, (x, y) => inBox(x, y, 10, 10, 30, 75) ? [120, 90, 60] : null),
  'tall/hat.png': png(40, 80, (x, y) => inBox(x, y, 8, 4, 32, 14) ? [60, 160, 60] : null),
  'thumbs/blob.png': png(8, 8, () => [200, 150, 100])
};
const L = { license: 'LicenseRef-Private', author: 'Test', source: 'original' };
const parts = {
  schema: 'cpa-avatar/1', pack: 'rpk',
  template: { id: 'rpk-v1', viewBox: [0, 0, 60, 90], sizeIn: { w: 2, h: 3 }, anchors: {} },
  slots: [{ id: 'body', name: 'Animal', z: 20, required: true }, { id: 'top', name: 'Top', z: 40, optional: true }, { id: 'hat', name: 'Hat', z: 70, optional: true }, { id: 'handheld', name: 'Holding', z: 80, optional: true }],
  colorSlots: {},
  parts: [
    Object.assign({ id: 'rpk.avatar.body-blob', slot: 'body', name: 'Blob', file: 'bases/blob.png', exclusive: true, canvas: { px: [60, 90], dpi: 30 }, thumb: 'thumbs/blob.png' }, L),
    Object.assign({ id: 'rpk.avatar.body-tall', slot: 'body', name: 'Tall', file: 'bases/tall.png', exclusive: true, canvas: { px: [40, 80], dpi: 20 } }, L),
    Object.assign({ id: 'rpk.avatar.blob-shirt', slot: 'top', name: 'Shirt', file: 'blob/shirt.png', bodies: ['rpk.avatar.body-blob'] }, L),
    Object.assign({ id: 'rpk.avatar.blob-hat', slot: 'hat', name: 'Hat', file: 'blob/hat.png', bodies: ['rpk.avatar.body-blob'] }, L),
    Object.assign({ id: 'rpk.avatar.blob-cup', slot: 'handheld', name: 'Cup', file: 'blob/cup.png', bodies: ['rpk.avatar.body-blob'] }, L),
    Object.assign({ id: 'rpk.avatar.tall-hat', slot: 'hat', name: 'Tall hat', file: 'tall/hat.png', bodies: ['rpk.avatar.body-tall'] }, L)
  ],
  presets: [
    { id: 'rpk-blob', name: 'Blob', parts: { body: 'rpk.avatar.body-blob' }, thumb: 'thumbs/blob.png' },
    { id: 'rpk-blob-dressed', name: 'Blob dressed', parts: { body: 'rpk.avatar.body-blob', top: 'rpk.avatar.blob-shirt', hat: 'rpk.avatar.blob-hat' } },
    { id: 'rpk-tall', name: 'Tall', parts: { body: 'rpk.avatar.body-tall' } }
  ]
};
const catalog = { schema: 'cpa-catalog/1', pack: { id: 'rpk', name: 'Raster test pack', version: '1', license: 'LicenseRef-Private' }, categories: [], assets: [] };
const zf = { 'pack.json': Buffer.from(JSON.stringify(catalog)), 'avatar/parts.json': Buffer.from(JSON.stringify(parts)) };
for (const [k, v] of Object.entries(files)) zf['avatar/' + k] = v;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-rpk-'));
  fs.writeFileSync(path.join(tmp, 'pack.json'), JSON.stringify(catalog)); fs.mkdirSync(path.join(tmp, 'avatar'));
  fs.writeFileSync(path.join(tmp, 'avatar', 'parts.json'), JSON.stringify(parts));
  for (const [k, v] of Object.entries(files)) { const f = path.join(tmp, 'avatar', k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); }
  const tool = path.join(R, 'tools', 'build_assets.js');
  let r1 = spawnSync(process.execPath, [tool, '--check', '--private', '--root', tmp], { encoding: 'utf8' });
  ok(r1.status === 0, '--private accepts raster parts on their body canvas (' + (r1.stdout + r1.stderr).trim().split('\n').pop() + ')');
  fs.writeFileSync(path.join(tmp, 'avatar', 'blob', 'hat.png'), png(61, 90, () => null));
  r1 = spawnSync(process.execPath, [tool, '--check', '--private', '--root', tmp], { encoding: 'utf8' });
  ok(r1.status !== 0 && /61×90 but its canvas is 60×90/.test(r1.stderr), 'an overlay on the wrong canvas size is caught');
  fs.rmSync(tmp, { recursive: true, force: true });

  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.avatarParts() && window.CST.assets_ui, { timeout: 8000 });
  const imp = await p.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { await window.CST.assets_ui.importPack(new File([bytes], 'rpk.cpapack.zip', { type: 'application/zip' })); return 'ok'; } catch (e) { return e.message; }
  }, zip(zf).toString('base64'));
  ok(imp === 'ok', 'a raster avatar pack imports (' + imp + ')');

  const c = await p.evaluate(async () => {
    const C = window.CST, A = C.avatar;
    const blob = { parts: { body: 'rpk.avatar.body-blob', top: 'rpk.avatar.blob-shirt', hat: 'rpk.avatar.blob-hat' } };
    const svg = await A.compose(blob);
    const err = A.validate({ parts: { body: 'rpk.avatar.body-blob' } });
    const tallSvg = await A.compose({ parts: { body: 'rpk.avatar.body-tall' } });
    const coreOnBlob = A.fits(C.assets.avatarParts().parts.find(x => x.id === 'core.avatar.face-round'), 'rpk.avatar.body-blob');
    const mixed = A.clean({ parts: { body: 'rpk.avatar.body-tall', top: 'rpk.avatar.blob-shirt', hat: 'rpk.avatar.blob-hat' } });
    return { svg: svg.slice(0, 400), images: (svg.match(/<image /g) || []).length, err, tallSvg: tallSvg.slice(0, 300), coreOnBlob, mixed: mixed.parts,
      dropped: A.resolve({ parts: { body: 'rpk.avatar.body-tall', hat: 'rpk.avatar.blob-hat' } }).map(x => x.part.id) };
  });
  ok(/viewBox="0 0 60 90" width="2in" height="3in"/.test(c.svg) && c.images === 3, 'base + overlays compose as stacked <image> layers on the 60×90 px canvas at 30 dpi = 2×3 in');
  ok(/viewBox="0 0 40 80" width="2in" height="4in"/.test(c.tallSvg), 'another body uses its own canvas (40×80 px at 20 dpi = 2×4 in)');
  ok(c.err.length === 0, 'an exclusive raster body needs no face/eyes/mouth (' + c.err.join('; ') + ')');
  ok(c.coreOnBlob === false, 'generic core parts do not fit an exclusive body');
  ok(c.mixed.top === null && c.mixed.hat === null, 'clean() clears clothes that do not fit the new body');
  ok(c.dropped.length === 1, 'compose ignores a part that does not fit the chosen body');

  // The Avatar tab stays hidden, so the builder screen is not mounted. Composition and export are checked here.
  const ex = await p.evaluate(async () => {
    const C = window.CST, A = C.avatar, bbox = (q) => { let y0 = Infinity, y1 = -Infinity; for (const l of q.loops) for (const s of l) if (s[0] !== 'Z') { y0 = Math.min(y0, s[2]); y1 = Math.max(y1, s[2]); } return [y0, y1]; };
    const n0 = C.items.length;
    const plain = await A.toItem({ name: 'Blob', parts: { body: 'rpk.avatar.body-blob' } });
    const dressed = await A.toItem({ name: 'Blob dressed', parts: { body: 'rpk.avatar.body-blob', top: 'rpk.avatar.blob-shirt', hat: 'rpk.avatar.blob-hat', handheld: 'rpk.avatar.blob-cup' } });
    const q0 = C.processed(plain, false), q1 = C.processed(dressed, false);
    const tall = await A.toItem({ parts: { body: 'rpk.avatar.body-tall', hat: 'rpk.avatar.tall-hat' } });
    return { added: C.items.length - n0, w: dressed.wIn, h: dressed.hIn, tw: tall.wIn, th: tall.hIn, loops: q1.loops.length, top0: bbox(q0)[1] - bbox(q0)[0], top1: bbox(q1)[1] - bbox(q1)[0], sel: !!C.mkSel, kind: dressed.asset.kind,
      inMock: !!C.mkSel && C.nodeItem && C.nodeItem(C.mkSel) === tall };
  });
  ok(ex.added === 3 && ex.kind === 'avatar', 'three avatar stickers were added');
  ok(ex.w === 2 && ex.h === 3 && ex.tw === 2 && ex.th === 4, 'stickers come out at the body canvas size in inches (' + ex.w + '×' + ex.h + ', ' + ex.tw + '×' + ex.th + ')');
  ok(ex.loops === 1, 'the dressed sticker is one flattened piece with one cut line (' + ex.loops + ')');
  ok(ex.top1 > ex.top0 * 1.2, 'the cut line goes around the hat that sticks out above the body (cut height ' + ex.top0.toFixed(3) + ' → ' + ex.top1.toFixed(3) + ')');
  ok(ex.inMock, 'the new avatar is placed and selected in the Mockup');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
