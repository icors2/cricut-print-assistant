// P2·M3: Assets tab order, search, details, kid mode, and a 500-tile paint.
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
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.list().length === 5, { timeout: 8000 });
  await p.click('[data-tab=tabAssets]');
  const order = await p.evaluate(() => [...document.querySelectorAll('#assetCats [data-cat]')].map(b => b.dataset.cat));
  ok(order[0] === 'rooms' && order.indexOf('furniture') < order.indexOf('items') && order.indexOf('items') < order.indexOf('characters'), 'categories follow catalog order: ' + order.join(','));
  await p.type('#assetSearch', 'cafe');
  await p.waitForFunction(() => document.querySelector('.assetTile[data-id="core.furniture.round-sofa"]'), { timeout: 2000 });
  const label = await p.$eval('.assetTile[data-id="core.furniture.round-sofa"]', el => el.getAttribute('aria-label'));
  ok(/Round sofa, 2\.5 by 1\.4 inches/.test(label), 'tile name says the size: ' + label);
  await p.evaluate(() => { window.CST.S.ui = Object.assign({}, window.CST.S.ui, { bigTargets: true }); window.CST.applyChrome(); });
  const box = await p.$eval('.assetTile', el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok(box.w >= 88 && box.h >= 88, 'tiles are at least 88 px (' + box.w.toFixed(0) + '×' + box.h.toFixed(0) + ')');
  const ms = await p.evaluate(async () => {
    const assets = [];
    for (let i = 0; i < 500; i++) assets.push({ id: 'bulk.items.n' + i, name: 'Bulk ' + i, category: 'items', size: { w: 1, h: 1 }, files: { svg: 'x.svg', thumb: 'x.webp' }, cut: { shape: 'rect' }, regions: [], license: 'CC0-1.0', source: 'original' });
    window.CST.assets.addPack({ schema: 'cpa-catalog/1', pack: { id: 'bulk', name: 'Bulk', version: '0' }, categories: [{ id: 'items', name: 'Items', order: 9 }], assets }, 'pack', () => null);
    const s = document.querySelector('#assetSearch'); s.value = ''; s.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('#assetCats [data-cat=items]').click();
    const t0 = performance.now(); window.CST.assets_ui.paint(); return performance.now() - t0;
  });
  ok(ms < 300, '500 tiles paint in ' + ms.toFixed(0) + ' ms');
  await p.evaluate(() => { document.querySelector('#assetSearch').value = ''; window.CST.assets_ui.paint(); });
  await p.click('#assetCats [data-cat=furniture]');
  const tile = await p.$('.assetTile[data-id="core.furniture.round-sofa"]');
  const point = await tile.boundingBox();
  await p.touchscreen.tap(point.x + 10, point.y + 10).catch(() => {});
  await p.mouse.move(point.x + 10, point.y + 10);
  await p.mouse.down(); await new Promise(r => setTimeout(r, 600)); await p.mouse.up();
  const open = await p.$eval('#assetSheet', el => !el.hidden && /Round sofa/.test(el.textContent));
  ok(open, 'a long-press opens the details sheet');
  const kid = await p.evaluate(() => { window.CST.assets_ui.kidMode(true); return { layout: document.querySelector('[data-tab=tabLayout]').hidden, grown: !document.querySelector('#grownups').hidden }; });
  ok(kid.layout && kid.grown, 'kid mode hides Layout and shows Grown-ups');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
