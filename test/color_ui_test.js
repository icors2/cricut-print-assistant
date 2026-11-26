// P3·M2–M4: the colour sheet changes the print, not the cut. Surprise is seeded.
const puppeteer = require('puppeteer-core'), path = require('path'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.get('core.furniture.round-sofa'), { timeout: 8000 });
  const r = await p.evaluate(async () => {
    const C = window.CST, asset = C.assets.get('core.furniture.round-sofa');
    await C.assets.addAsset(asset);
    await new Promise(res => setTimeout(res, 80));
    C.computeLayout();
    const before = C.buildSVGs().join('\n');
    const pdf0 = C.buildPDF().output('arraybuffer');
    await C.color.open({ item: C.items[0], asset });
    document.querySelector('#colorRegions input[type=color]').value = '#ff00aa';
    document.querySelector('#colorRegions input[type=color]').dispatchEvent(new Event('input'));
    document.querySelector('#colorDone').click();
    await new Promise(res => setTimeout(res, 400));
    C.computeLayout();
    const after = C.buildSVGs().join('\n');
    const pdf1 = C.buildPDF().output('arraybuffer');
    const bytesDiffer = pdf0.byteLength !== pdf1.byteLength || new Uint8Array(pdf0).some((b, i) => b !== new Uint8Array(pdf1)[i]);
    const rec = C.items[0].asset.recolor;
    const depth = C.mkUndoDepth;
    C.mkUndo();
    await new Promise(res => setTimeout(res, 200));
    const undone = C.items[0].asset.recolor;
    const png = C.assets.get('core.items.teddy');
    const url = await C.assets.file(png, 'png');
    const maskUrl = await C.assets.file(Object.assign({}, png, { files: { png: png.files.masks.fur } }), 'png');
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const img = await load(url), mask = await load(maskUrl);
    const tinted = C.recolor.tintPNG(img, { fur: mask }, { fur: '#2244aa' }, png.regions);
    const srcD = document.createElement('canvas'); srcD.width = img.naturalWidth; srcD.height = img.naturalHeight; srcD.getContext('2d').drawImage(img, 0, 0);
    const a = srcD.getContext('2d').getImageData(0, 0, srcD.width, srcD.height).data, c = tinted.getContext('2d').getImageData(0, 0, tinted.width, tinted.height).data;
    let alpha = 0, paint = 0; for (let i = 0; i < a.length; i += 4) { if (a[i + 3] !== c[i + 3]) alpha++; if (a[i] !== c[i] || a[i + 1] !== c[i + 1] || a[i + 2] !== c[i + 2]) paint++; }
    const hue = C.recolor.tintPNG(img, { fur: mask }, { fur: '#ff0000' }, png.regions.map(x => Object.assign({}, x, { mode: 'hue' })));
    const big = document.createElement('canvas'); big.width = 64; big.height = 64; big.getContext('2d').fillRect(0, 0, 64, 64);
    const t0 = performance.now(); C.recolor.tintPNG(big, { fur: big }, { fur: '#112233' }, [{ id: 'fur' }]); const small = performance.now() - t0;
    console.log('tint sample ' + small.toFixed(1) + ' ms (4096² is not a CI gate)');
    const s1 = C.recolor.surprise(asset, 42), s2 = C.recolor.surprise(asset, 42), s3 = C.recolor.surprise(asset, 99);
    return { cutSame: before === after, pdfChanged: bytesDiffer, rec, depth, undone, alpha, paint, hue: hue.width === img.naturalWidth, surprise: JSON.stringify(s1) === JSON.stringify(s2) && JSON.stringify(s1) !== JSON.stringify(s3) };
  });
  ok(r.cutSame, 'the cut SVG is byte-identical after a recolor');
  ok(r.pdfChanged, 'the print PDF changes');
  ok(r.rec && r.rec.fabric === '#ff00aa' && r.depth >= 1, 'Done stores asset.recolor and commits one undo step');
  ok(!r.undone || r.undone.fabric !== '#ff00aa', 'undo puts the previous colours back');
  ok(r.alpha === 0 && r.paint > 0 && r.hue, 'PNG tint keeps alpha and changes paint (' + r.alpha + ' alpha diffs, ' + r.paint + ' paint diffs)');
  ok(r.surprise, 'Surprise is the same for a seed and different for another');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
