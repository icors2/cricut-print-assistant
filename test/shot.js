const puppeteer = require('puppeteer-core'), path = require('path'); const R = path.resolve(__dirname, '..');
(async () => { const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 }); await p.goto('file://' + R + '/index.html'); await p.evaluate(() => (localStorage.clear(), window.name = '')); await p.reload();
  await (await p.$('#file')).uploadFile(...['gradient_photo.jpg', 'star_sticker.png', 'heart.svg', 'label_square.jpg'].map(f => path.join(__dirname, 'samples', f)));
  await p.waitForFunction(() => window.CST.items.length === 4); await new Promise(r => setTimeout(r, 1500));
  await p.evaluate(() => { const C = window.CST, it = C.items; C.setPct(it[0], 75); it[0].qty = 2; it[0].shape = 'rounded'; C.setPct(it[1], 60); it[1].qty = 4; C.setPct(it[2], 150); it[2].qty = 3; C.setPct(it[3], 50); it[3].qty = 6; C.refresh(true); });
  await new Promise(r => setTimeout(r, 3000));
  // new UI: Sheet panel collapsed, two cards collapsed, one piece selected (its card highlighted)
  await p.click('#settings > h2'); await p.evaluate(() => { const c = document.querySelectorAll('#items .item'); c[0].querySelector('.chev').click(); c[2].querySelector('.chev').click(); c[3].querySelector('.chev').click(); });
  await p.evaluate(() => { const C = window.CST, e = C.layout.sheets[0].find(e => e.it.name === 'star_sticker.png'); C.selectPiece(e); }); await new Promise(r => setTimeout(r, 800));
  await p.screenshot({ path: path.join(R, 'sample_output/ui_screenshot.png') }); await b.close(); })();
