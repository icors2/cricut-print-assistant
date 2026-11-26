// One-off guide shots for the Assets tab and the colour sheet. Needs the local server.
const puppeteer = require('puppeteer-core'), path = require('path'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..'), IMG = path.join(R, 'docs', 'images');
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
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--window-size=1280,800'] });
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 800 });
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.list().length === 5);
  await p.click('[data-tab=tabAssets]');
  await p.waitForSelector('.assetTile');
  await p.screenshot({ path: path.join(IMG, '30_assets_tab.png') });
  await p.click('#assetCats [data-cat=furniture]');
  await p.waitForSelector('.assetTile[data-id="core.furniture.round-sofa"]');
  const tile = await p.$('.assetTile[data-id="core.furniture.round-sofa"]');
  const box = await tile.boundingBox();
  await p.mouse.move(box.x + 20, box.y + 20); await p.mouse.down();
  await new Promise(r => setTimeout(r, 700)); await p.mouse.up();
  await p.waitForFunction(() => !document.querySelector('#assetSheet').hidden);
  await p.screenshot({ path: path.join(IMG, '31_asset_details.png') });
  console.log('wrote 30_assets_tab.png and 31_asset_details.png');
  srv.child.kill(); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
