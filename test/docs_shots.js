// Regenerates every picture in docs/images/ from the built index.html with the made-up sample images in test/samples/.
// Run: cd test && node docs_shots.js   (needs make_samples.py / make_scene.py outputs, pdftoppm, Chrome)
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), IMG = path.join(R, 'docs', 'images'), S = path.join(__dirname, 'samples'), SC = path.join(S, 'scene');
fs.mkdirSync(IMG, { recursive: true });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));
const pdfPage = (b64, name, dpi = 60, page = 1) => { const f = path.join(TMP, name + '.pdf'); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  execFileSync('pdftoppm', ['-r', String(dpi), '-f', String(page), '-l', String(page), '-png', '-singlefile', f, path.join(TMP, name)]); return path.join(TMP, name + '.png'); };
// synthetic first-pass readings (made-up printer: 2.55% / 2.80% shrink, 0.4° paper rotation) – same as test/cal_ui_test.js
const PASS1 = { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const shot = async (name, opt) => { await p.screenshot(Object.assign({ path: path.join(IMG, name) }, opt || {})); console.log('wrote docs/images/' + name); };
  const el = async (sel, name) => { const h = await p.$(sel); await h.evaluate(e => e.scrollIntoView({ block: 'center' })); await wait(200); await h.screenshot({ path: path.join(IMG, name) }); console.log('wrote docs/images/' + name); };
  const fresh = async () => { await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload(); await wait(500); };

  // ---------- Layout ----------
  await fresh();
  await (await p.$('#file')).uploadFile(...['gradient_photo.jpg', 'star_sticker.png', 'heart.svg', 'label_square.jpg', 'donut_badge.png'].map(f => path.join(S, f)));
  await p.waitForFunction(() => window.CST.items.length === 5, { timeout: 20000 }); await wait(1200);
  await p.evaluate(() => { const C = window.CST, it = C.items; C.setPct(it[0], 75); it[0].qty = 2; it[0].shape = 'rounded'; C.setPct(it[1], 60); it[1].qty = 4; C.setPct(it[2], 150); it[2].qty = 3; C.setPct(it[3], 50); it[3].qty = 4; C.setPct(it[4], 60); it[4].qty = 3; C.refresh(true); });
  await wait(2500);
  await shot('01_layout_overview.png');
  await p.evaluate(() => { const c = document.querySelectorAll('#items .item'); [0, 2, 3, 4].forEach(i => c[i].querySelector('.chev').click()); }); await wait(300);
  await el('#items .item:nth-child(2)', '02_image_card.png', 6);
  await p.evaluate(() => window.scrollTo(0, 0));
  await el('#settings', '03_sheet_panel.png', 6);
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
  // drag a piece on the canvas (mid-drag, snapping guides visible)
  const d = await p.evaluate(() => { const C = window.CST, e = C.layout.sheets[0].find(e => e.it.name === 'star_sticker.png'), c = document.querySelector('#preview'), r = c.getBoundingClientRect(), k = r.width / c.width, v = C.view;
    const sx = (x) => r.left + x * v.sc * k, sy = (y) => r.top + y * v.sc * k, w = e.rot ? e.p.cutH : e.p.cutW, h = e.rot ? e.p.cutW : e.p.cutH; return { a: [sx(e.x + w / 2), sy(e.y + h / 2)], z: [sx(e.x + w / 2 + 0.9), sy(e.y + h / 2 + 0.6)] }; });
  await p.mouse.move(...d.a); await p.mouse.down(); await p.mouse.move(...d.z, { steps: 14 }); await wait(250);
  await shot('04_canvas_drag.png'); await p.mouse.up(); await wait(600);
  await el('#chips', '05_status_chips.png', 8).catch(() => {});
  // print PDF vs cut SVG for sheet 1
  const ex = await p.evaluate(() => { const C = window.CST; C.computeLayout(); return { pdf: C.buildPDF().output('datauristring').split(',')[1], svg: C.buildSVGs()[0] }; });
  const pdfPng = pdfPage(ex.pdf, 'print', 60);
  const p2 = await b.newPage(); await p2.setViewport({ width: 1010, height: 750 });
  await p2.setContent(`<html><body style="margin:0;font:15px system-ui,sans-serif;background:#eef1f5;display:flex;gap:28px;padding:22px;align-items:flex-start">
    <figure style="margin:0;text-align:center"><img src="data:image/png;base64,${fs.readFileSync(pdfPng).toString('base64')}" style="height:660px;background:#fff;box-shadow:0 2px 8px #0003"><figcaption><b>…-PRINT.pdf</b> – print at 100% / Actual size</figcaption></figure>
    <figure style="margin:0;text-align:center"><div style="height:660px;width:510px;background:#fff;box-shadow:0 2px 8px #0003;display:flex;align-items:center;justify-content:center"><img src="data:image/svg+xml;base64,${Buffer.from(ex.svg).toString('base64')}" style="width:480px"></div><figcaption><b>…-CUT.svg</b> – upload to Design Space (8 × 10.5 in, one layer)</figcaption></figure></body></html>`);
  await wait(500); await p2.screenshot({ path: path.join(IMG, '06_print_and_cut_files.png') }); console.log('wrote docs/images/06_print_and_cut_files.png'); await p2.close(); await p.bringToFront();

  // ---------- Calibrate ----------
  await fresh(); await p.click('.tabs button[data-tab=tabCal]'); await wait(500);
  await shot('07_calibrate_tab.png');
  const cal = await p.evaluate(() => window.CST.buildCalPDF().output('datauristring').split(',')[1]);
  fs.copyFileSync(pdfPage(cal, 'cal', 50), path.join(IMG, '08_calibration_sheet.png')); console.log('wrote docs/images/08_calibration_sheet.png');
  await p.select('#calCode', 'none');
  for (const [id, [x, y]] of Object.entries(PASS1)) for (const [a, v] of [['x', x], ['y', y]]) { const s = `input[data-t=${id}][data-a=${a}]`; await p.$eval(s, e => e.value = ''); await p.type(s, String(v)); }
  await p.type('#rulerX', '7.80'); await p.click('#calCompute'); await wait(700);
  await el('#caltable', '09_calibrate_readings.png', 10).catch(async () => { await shot('09_calibrate_readings.png'); });
  await el('#verdict', '10_calibrate_verdict.png', 10);
  await p.click('#chooseComp'); await wait(600);
  await el('#wizard', '11_calibrate_pass2_checklist.png', 10);

  // ---------- Design Space illustrations (drawn here; not screenshots of Design Space) ----------
  const p3 = await b.newPage(); await p3.setViewport({ width: 1200, height: 640 });
  const box = (n, t, body) => `<div style="flex:1;background:#fff;border:1px solid #cfd6df;border-radius:12px;padding:14px 16px;box-shadow:0 1px 4px #0001"><div style="font-weight:700;margin-bottom:8px"><span style="display:inline-block;width:26px;height:26px;border-radius:50%;background:#1d2733;color:#fff;text-align:center;line-height:26px;margin-right:8px">${n}</span>${t}</div>${body}</div>`;
  await p3.setContent(`<html><body style="margin:0;font:14px system-ui,sans-serif;background:#eef1f5;padding:20px">
    <div style="display:flex;gap:14px">
    ${box(1, 'Upload the cut file', `<div style="border:2px dashed #9aa6b4;border-radius:8px;padding:18px;text-align:center;color:#556">New Project → <b>Upload</b> → Upload Image<br><br>📄 <code>sheet-letter-1-CUT.svg</code><br><br>Upload → add it to the canvas</div>`)}
    ${box(2, 'Check the size – don\'t touch it', `<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin:18px 0"><div style="border:1px solid #9aa6b4;border-radius:6px;padding:6px 10px">W <b>8</b> in</div>🔒<div style="border:1px solid #9aa6b4;border-radius:6px;padding:6px 10px">H <b>10.5</b> in</div></div><ul style="margin:0;padding-left:18px;color:#334"><li>Operation: <b>Basic Cut</b></li><li>One layer (Attach if it split)</li><li>No move / resize / flip / rotate</li></ul>`)}
    ${box(3, 'Make → On Mat', `<svg viewBox="0 0 130 130" width="100%" height="190"><rect x="5" y="5" width="120" height="120" fill="#dfe9f2" stroke="#7d8da0"/>${Array.from({ length: 11 }, (_, i) => `<line x1="${15 + i * 10}" y1="5" x2="${15 + i * 10}" y2="125" stroke="#c4d2df" stroke-width=".5"/><line x1="5" y1="${15 + i * 10}" x2="125" y2="${15 + i * 10}" stroke="#c4d2df" stroke-width=".5"/>`).join('')}<rect x="7.5" y="7.5" width="80" height="105" fill="none" stroke="#e0115f" stroke-dasharray="3 2"/><text x="12" y="62" font-size="6" fill="#e0115f">design 0.25 in from</text><text x="12" y="70" font-size="6" fill="#e0115f">the top-left –</text><text x="12" y="78" font-size="6" fill="#e0115f">don't drag it</text></svg><div style="color:#334">Mat 12 × 12 in, Mirror off</div>`)}
    ${box(4, 'Sheet on the mat at 0,0', `<svg viewBox="0 0 130 130" width="100%" height="190"><rect x="5" y="5" width="120" height="120" fill="#dfe9f2" stroke="#7d8da0"/><rect x="5" y="5" width="85" height="110" fill="#fff" stroke="#556"/><rect x="5" y="5" width="85" height="110" fill="none"/><rect x="7.5" y="7.5" width="80" height="105" fill="none" stroke="#1f6feb" stroke-dasharray="2 2"/>${[[7.5, 7.5], [86.5, 7.5], [7.5, 111.5], [86.5, 111.5]].map(([x, y]) => `<rect x="${x}" y="${y}" width="1.2" height="1.2" fill="#000"/>`).join('')}<circle cx="5" cy="5" r="4" fill="none" stroke="#e0115f" stroke-width="1.5"/><text x="12" y="125" font-size="7" fill="#556">print side up · top edge feeds first</text></svg><div style="color:#334">Paper's top-left corner exactly on the grid's 0,0</div>`)}
    </div>
    <p style="color:#667;margin:14px 2px 0;font-size:12px">Illustration only – Design Space's real screens look different and change between versions. What matters: the uploaded SVG keeps its size (8 × 10.5 in on Letter) and Design Space places it 0.25 in from the mat's top-left corner.</p></body></html>`);
  await wait(400); const hgt = await p3.evaluate(() => Math.ceil(document.querySelector('p').getBoundingClientRect().bottom) + 18); await p3.setViewport({ width: 1200, height: hgt });
  await p3.screenshot({ path: path.join(IMG, '12_design_space_steps.png') }); console.log('wrote docs/images/12_design_space_steps.png'); await p3.close(); await p.bringToFront();

  // ---------- Mockup ----------
  await fresh();
  const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction(() => window.CST.items.length === 7, { timeout: 20000 });
  await p.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500);
  await p.click('.tabs button[data-tab=tabMock]'); await wait(900);
  await p.evaluate(() => window.CST.mkSelect(null)); await wait(200);
  await shot('13_mockup_scene.png');
  await p.select('#mkGuide', 'outline'); await wait(400); await shot('14_mockup_guide_outline.png'); await p.select('#mkGuide', 'off'); await wait(300);
  // resize with a corner handle (mid-drag)
  const rz = await p.evaluate(() => { const C = window.CST, n = C.MK.nodes.find(n => C.items.find(i => i.id === n.itemId).name === 'sofa.png'); C.mkSelect(n); const g = C.mkGeom(n), c = document.querySelector('#mkCanvas'), r = c.getBoundingClientRect(), v = C.mkView, k = r.width / c.width;
    const s = (x, y) => [r.left + (v.pad + x * v.sc) * k, r.top + (v.pad + y * v.sc) * k]; return { a: s(n.x + g.w / 2, n.y + g.h / 2), z: s(n.x + g.w / 2 + 0.8, n.y + g.h / 2 + 0.45) }; });
  await wait(200); await p.mouse.move(...rz.a); await p.mouse.down(); await p.mouse.move(...rz.z, { steps: 12 }); await wait(250); await shot('15_mockup_resize.png'); await p.mouse.up(); await wait(1500);
  await p.evaluate(() => window.CST.mkUndo()); await wait(1200);
  // background image: tiled wallpaper, adjust mode on
  await (await p.$('#mkBgFile')).uploadFile(path.join(S, 'bg', 'wallpaper_tile_150dpi.png')); await wait(800);
  await p.evaluate(() => { const s = (q, v) => { const e = document.querySelector(q); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }; s('#mkBgFit', 'tile'); s('#mkBgScaleN', '60'); s('#mkBgOp', '85'); window.CST.mkSelect(null); window.CST.mkBgAdj = true; }); await wait(500);
  await shot('16_mockup_background.png'); await p.evaluate(() => { window.CST.mkBgAdj = false; }); await wait(200);
  // send to layout: 2 sofas, rug removed from the layers
  await p.evaluate(() => { const C = window.CST, nd = (nm) => C.MK.nodes.filter(n => C.items.find(i => i.id === n.itemId).name === nm); C.mkSelect(nd('bear_headset.png')[0]); document.querySelector('#mkDup').click(); C.mkSelect(nd('rug.png')[0]); document.querySelector('#mkDel').click(); C.mkSelect(null); }); await wait(500);
  await p.click('#mkSend'); await wait(400); await shot('17_send_to_layout_dialog.png');
  await p.click('#mkSendOk'); await wait(2000); await shot('18_layout_after_send.png');
  // assembly steps: numbers by layer order, one number hidden with the layer's # toggle, the selected piece's checkbox
  await p.click('.tabs button[data-tab=tabMock]'); await wait(800); await p.select('#mkGuide', 'outline'); await wait(400);
  await p.evaluate(() => { const C = window.CST, nd = (nm) => C.MK.nodes.filter(n => C.items.find(i => i.id === n.itemId).name === nm); const n = nd('floor_lamp.png')[0];
    document.querySelector(`#mkLayers .lrow[data-uid="${n.uid}"] .lnumtog`).click(); C.mkSelect(nd('bear_headset.png')[1]); window.scrollTo(0, 0); }); await wait(500);
  await shot('20_guide_step_numbers.png');
  const gp = await p.evaluate(() => window.CST.guidePNG()); fs.writeFileSync(path.join(IMG, '21_guide_png_legend.png'), Buffer.from(gp.split(',')[1], 'base64')); console.log('wrote docs/images/21_guide_png_legend.png');
  await p.select('#mkGuide', 'off'); await wait(300);
  // how-to tab
  await p.click('.tabs button[data-tab=tabHow]'); await wait(400); await shot('19_howto_tab.png');
  await b.close();
  if (errs.length) { console.error('page errors', errs); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
