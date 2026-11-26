const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => (localStorage.clear(), window.name = '')); await p.reload();
  const inp = await p.$('#file'); const S = path.join(__dirname, 'samples');
  await inp.uploadFile(...['star_sticker.png', 'donut_badge.png', 'two_blobs.png', 'gradient_photo.jpg', 'label_square.jpg', 'heart.svg'].map(f => path.join(S, f)));
  await p.waitForFunction(() => window.CST.items.length === 6, { timeout: 20000 }).catch(e => { console.log('ERRS', errs, 'n'); throw e; }); await new Promise(r => setTimeout(r, 1500));
  // configure items like a real sheet
  await p.evaluate(() => { const it = window.CST.items; const set = (i, o) => Object.assign(it[i], o);
    set(0, { wIn: 2, hIn: 2, qty: 4, shape: 'contour', offsetIn: 0.06, border: 'white' });     // star with white sticker border
    set(1, { wIn: 1.75, hIn: 1.75, qty: 3, shape: 'contour', offsetIn: 0, border: 'extend' }); // donut: tight cut, bleed extends colours
    set(2, { wIn: 2.6, hIn: 2.6 * 500 / 900, qty: 2, shape: 'contour', offsetIn: 0.08, border: 'white' }); // two blobs merged by offset
    set(3, { qty: 2, shape: 'rounded', radiusIn: 0.15 });
    set(4, { wIn: 1.0, hIn: 1.0, qty: 4, shape: 'rect' });
    set(5, { qty: 3, shape: 'contour', offsetIn: 0.04, border: 'white' });
    window.CST.cache.clear(); window.CST.refresh(true); });
  await new Promise(r => setTimeout(r, 4000));
  // ---- exercise the new Scale % control through the real UI ----
  const cardOf = async (name) => (await p.$$('.item')).find(async () => true) && (await Promise.all((await p.$$('.item')).map(async c => [c, await c.$eval('.iname', e => e.textContent)]))).find(([, n]) => n === name)[0];
  let card = await cardOf('gradient_photo.jpg'); await (await card.$('.pp[data-p="75"]')).click(); await new Promise(r => setTimeout(r, 2500));
  card = await cardOf('heart.svg'); const pin = await card.$('[data-f=pct] input'); await pin.click({ clickCount: 3 }); await pin.type('153.6'); await pin.evaluate(e => e.dispatchEvent(new Event('change'))); await new Promise(r => setTimeout(r, 2500));
  card = await cardOf('label_square.jpg'); const win = await card.$('[data-f=w] input'); await win.click({ clickCount: 3 }); await win.type('1.5'); await win.evaluate(e => e.dispatchEvent(new Event('change'))); await new Promise(r => setTimeout(r, 2500));
  const pctCheck = await p.evaluate(() => { const C = window.CST; return C.items.map(i => ({ name: i.name, base: +i.baseWIn.toFixed(4), pct: +C.pctOf(i).toFixed(2), w: +i.wIn.toFixed(4), h: +i.hIn.toFixed(4),
    uiPct: (() => { const c = Array.from(document.querySelectorAll('.item')).find(c => c.querySelector('.iname').textContent === i.name); return c && +c.querySelector('[data-f=pct] input').value; })(),
    uiW: (() => { const c = Array.from(document.querySelectorAll('.item')).find(c => c.querySelector('.iname').textContent === i.name); return c && +c.querySelector('[data-f=w] input').value; })() })); });
  fs.writeFileSync(path.join(OUT, 'pct_check.json'), JSON.stringify(pctCheck, null, 1));
  const res = await p.evaluate(async () => {
    const C = window.CST, L = C.computeLayout(), toB64 = (ab) => { let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const pdf = toB64(C.buildPDF().output('arraybuffer')), svgs = C.buildSVGs();
    const place = L.sheets.map(pl => pl.map(e => ({ name: e.it.name, x: e.x, y: e.y, w: e.p.cutW, h: e.p.cutH, rot: e.rot, px: e.x + e.p.print.x, py: e.y + e.p.print.y, pw: e.p.print.w, ph: e.p.print.h })));
    const cv = document.createElement('canvas'); document.body.append(cv); const pv = [];
    for (let i = 0; i < L.sheets.length; i++) { /* preview per sheet at 100 px/in */ }
    return { pdf, svgs, place, sheet: L.sh, margin: L.m, warn: L.warn, comps: C.items.map(i => [i.name, C.cache.size]) };
  });
  fs.writeFileSync(path.join(OUT, 'sample-letter-PRINT.pdf'), Buffer.from(res.pdf, 'base64'));
  res.svgs.forEach((s, i) => fs.writeFileSync(path.join(OUT, `sample-letter-${i + 1}-CUT.svg`), s));
  fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify({ sheet: res.sheet, margin: res.margin, inset: 0.25, spacing: 0.125, place: res.place, warn: res.warn }, null, 1));
  // UI screenshot + preview canvas PNG
  await p.evaluate(() => window.CST.refresh(true)); await new Promise(r => setTimeout(r, 1500));
  await p.screenshot({ path: path.join(OUT, 'ui_screenshot.png'), fullPage: true });
  const prev = await p.evaluate(() => { const c = document.createElement('canvas'); const box = document.createElement('div'); box.style.width = '900px'; box.append(c); document.body.append(box); window.CST.drawPreview(c, { scale: 100 }); return c.toDataURL('image/png'); });
  fs.writeFileSync(path.join(OUT, 'preview_sheet1_print+cut.png'), Buffer.from(prev.split(',')[1], 'base64'));
  // oversize %: should be skipped with the existing warning, no error
  card = await cardOf('label_square.jpg'); const pin2 = await card.$('[data-f=pct] input'); await pin2.click({ clickCount: 3 }); await pin2.type('1000'); await pin2.evaluate(e => e.dispatchEvent(new Event('change'))); await new Promise(r => setTimeout(r, 2500));
  const over = await p.evaluate(() => ({ warn: window.CST.layout.warn, placed: window.CST.layout.sheets.reduce((t, s) => t + s.length, 0), itemNote: Array.from(document.querySelectorAll('.item')).find(c => c.querySelector('.iname').textContent === 'label_square.jpg').querySelector('.imeta').textContent }));
  await p.evaluate(() => { const it = window.CST.items.find(i => i.name === 'label_square.jpg'); window.CST.setPct(it, 75); window.CST.refresh(true); }); await new Promise(r => setTimeout(r, 2000));
  fs.writeFileSync(path.join(OUT, 'oversize_check.json'), JSON.stringify(over, null, 1));
  // calibration: zero correction files, then simulate readings and recompute
  const cal = await p.evaluate(() => { const C = window.CST; const toB64 = (ab) => { let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const pdf = toB64(C.buildCalPDF().output('arraybuffer')), svg = C.buildCalSVG();
    // simulated measurement: cut lands 1.0 mm right everywhere plus 0.5 mm extra at right edge; 0.75 mm low
    const t = C.calTargets(C.sheetDims()), r = {}; for (const q of t) r[q.id] = { x: 1.0 + 0.5 * (q.x - 0.25 - 0.75) / (8.5 - 2 * 1.0), y: 0.75 };
    const fit = C.computeCalibration(r); C.setCorr(fit.corr); const svg2 = C.buildCalSVG(); C.computeLayout(); const svgsCorr = C.buildSVGs();
    return { pdf, svg, fit: { printerModel: fit.m, verdict: fit.v.status, corr: fit.corr }, svg2, svgCorr1: svgsCorr[0] }; });
  fs.writeFileSync(path.join(OUT, 'calibration-letter-PRINT.pdf'), Buffer.from(cal.pdf, 'base64'));
  fs.writeFileSync(path.join(OUT, 'calibration-letter-CUT.svg'), cal.svg);
  fs.writeFileSync(path.join(OUT, 'calibration-letter-CUT_after_simulated_correction.svg'), cal.svg2);
  fs.writeFileSync(path.join(OUT, 'sample-letter-1-CUT_with_simulated_correction.svg'), cal.svgCorr1);
  fs.writeFileSync(path.join(OUT, 'cal_fit.json'), JSON.stringify(cal.fit, null, 1));
  // other sheet sizes quick check (SVG/PDF dims)
  const dims = await p.evaluate(() => { const C = window.CST, o = {}; C.setCorr({ ax: 0, ay: 0, bx: 0, by: 0 });
    for (const s of ['a4', 'legal', 'sq12']) { C.S.sheet = s; C.cache.clear(); C.computeLayout(); const d = C.buildPDF(); o[s] = { pdf: [d.internal.pageSize.getWidth(), d.internal.pageSize.getHeight()], svg: C.buildSVGs()[0].match(/width="([^"]+)" height="([^"]+)" viewBox="([^"]+)"/).slice(1), sheets: C.layout.sheets.length, warn: C.layout.warn, mat: C.layout.mi.mat }; }
    C.S.sheet = 'letter'; return o; });
  fs.writeFileSync(path.join(OUT, 'other_sizes.json'), JSON.stringify(dims, null, 1));
  // How-to tab screenshot
  await p.click('.tabs button[data-tab=tabCal]'); await new Promise(r => setTimeout(r, 300)); await p.screenshot({ path: path.join(OUT, 'ui_calibrate_tab.png'), fullPage: true });
  console.log(JSON.stringify({ pctCheck, over, errs, warn: res.warn, sheets: res.place.length, pieces: res.place.map(s => s.length), fit: cal.fit, dims }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
