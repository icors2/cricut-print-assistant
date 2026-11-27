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
  const beforeBg = await p.evaluate(() => window.CST.items.length);
  await p.click('.assetTile[data-id="core.rooms.sunny-room"]');
  await p.waitForFunction(() => document.querySelector('#tabMock').style.display !== 'none', { timeout: 4000 });
  const bg = await p.evaluate(() => ({ items: window.CST.items.length, name: window.CST.MK.bg.imgName, img: !!(window.CST.MK.bg.img && window.CST.MK.bg.img.length > 20) }));
  ok(bg.items === beforeBg && bg.img && bg.name === 'Sunny room', 'Sunny room loads as the background and is not a sticker (' + bg.items + ' images, ' + bg.name + ')');
  await p.click('[data-tab=tabAssets]');
  const order = await p.evaluate(() => [...document.querySelectorAll('#assetCats [data-cat]')].map(b => b.dataset.cat));
  ok(order[0] === 'rooms' && order.indexOf('furniture') < order.indexOf('items') && order.indexOf('items') < order.indexOf('characters') && order.indexOf('characters') < order.indexOf('clothing'), 'categories follow catalog order: ' + order.join(','));
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
  const sideBySide = await p.evaluate(() => {
    const tiles = [...document.querySelectorAll('#assetGrid .assetTile')].slice(0, 2).map(el => el.getBoundingClientRect());
    return tiles.length === 2 && Math.abs(tiles[0].top - tiles[1].top) < 8 && tiles[0].left !== tiles[1].left;
  });
  ok(sideBySide, 'asset tiles sit side by side');
  await p.click('.assetTile[data-id="core.furniture.round-sofa"]');
  await p.waitForFunction(() => {
    const t = document.querySelector('#toast');
    return t && t.classList.contains('show') && /added to your scene/.test(t.textContent) && !t.querySelector('button');
  }, { timeout: 4000 });
  const gone = await p.evaluate(() => new Promise(res => setTimeout(() => res(!document.querySelector('#toast').classList.contains('show')), 1800)));
  ok(gone, 'adding a sticker shows a note that goes away');
  await p.click('[data-tab=tabMock]');
  const beforePick = await p.evaluate(() => window.CST.items.length);
  await p.click('#mkBgAsset');
  await p.waitForSelector('#bgPickSheet:not([hidden]) [data-bg="core.furniture.lamp"]', { timeout: 4000 });
  await p.click('#bgPickSheet [data-bgcat=clothing]');
  const emptyClothes = await p.$eval('#bgPickGrid', el => /Nothing in this category yet/.test(el.textContent));
  ok(emptyClothes, 'Clothing is a category and starts empty');
  await p.click('#bgPickSheet [data-bgcat=""]');
  await p.waitForSelector('#bgPickSheet [data-bg="core.furniture.lamp"]', { timeout: 4000 });
  await p.click('#bgPickSheet [data-bg="core.furniture.lamp"]');
  await p.waitForFunction(() => window.CST.MK.bg.imgName === 'Lamp' && document.querySelector('#bgPickSheet').hidden, { timeout: 4000 });
  const picked = await p.evaluate(() => ({ items: window.CST.items.length, name: window.CST.MK.bg.imgName }));
  ok(picked.items === beforePick && picked.name === 'Lamp', 'choosing an asset sets the background and does not add a sticker (' + picked.items + ' images, ' + picked.name + ')');
  await p.click('[data-tab=tabAssets]');
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
