const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'); const R = path.resolve(__dirname, '..');
(async () => { const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-features=WebShare'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { errs.push(d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html');
  const png = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'samples/star_sticker.png')).toString('base64');
  const proj = { app: 'cricut-full-sheet-tool', v: 1, settings: {}, items: [{ name: 'star.png', dataURL: png, isSvg: false, pct: 50, qty: 2, shape: 'contour', offsetIn: 0.05, border: 'white', rotate: true }] };
  fs.writeFileSync('/tmp/proj.json', JSON.stringify(proj)); await (await p.$('#projFile')).uploadFile(fs.realpathSync('/tmp/proj.json')); await new Promise(r => setTimeout(r, 3000));
  const r1 = await p.evaluate(() => window.CST.items.map(i => [i.name, +i.wIn.toFixed(4), +window.CST.pctOf(i).toFixed(2), i.qty]));
  // save -> reload roundtrip
  const saved = await p.evaluate(() => new Promise(res => { const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(res); URL.createObjectURL = orig; return orig(b); }; document.querySelector('#saveProj').click(); }));
  const sj = JSON.parse(saved); console.log(JSON.stringify({ loadedPctOnly: r1, savedFields: Object.keys(sj.items[0]).filter(k => k !== 'dataURL'), savedPct: sj.items[0].pct, savedW: sj.items[0].wIn, errs })); await b.close(); })();
