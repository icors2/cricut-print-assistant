// Calibrate tab end-to-end in the real page: synthetic first-pass readings -> verdict -> compensate -> pass-2 files -> simulated pass-2 readings -> "Calibrated".
// All readings come from a made-up physical model: printer shrink 2.55% / 2.80%, paper 0.4 deg clockwise, mat shift -0.95/-1.85 mm (read to 0.25 mm).
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'); const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), MM = 25.4;
const PASS1 = { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
const WORLD = { shrinkX: 0.0255, shrinkY: 0.028, rotDeg: 0.4, matOff: [-0.95, -1.85] };
const dpath = (svg) => /id="cuts"[^>]* d="([^"]+)"/.exec(svg)[1];
const subpaths = (d) => d.split('Z').filter(x => x.trim()).map(sp => { const n = (sp.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number); const pts = []; for (let i = 0; i < n.length; i += 2) pts.push([n[i] / 72 + 0.25, n[i + 1] / 72 + 0.25]); return pts; });
const ctr = (sq) => sq.reduce((a, q) => [a[0] + q[0] / sq.length, a[1] + q[1] / sq.length], [0, 0]);
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage(); await p.setViewport({ width: 1300, height: 1000, deviceScaleFactor: 1.25 });
  const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => (localStorage.clear(), window.name = ''));
  // legacy v1 correction must migrate
  await p.evaluate(() => localStorage.setItem('cst.corr.letter-P', JSON.stringify({ ax: 0.04, ay: 0.03, bx: 0.003, by: 0 }))); await p.reload(); await new Promise(r => setTimeout(r, 800));
  const legacy = await p.evaluate(() => ({ cal: window.CST.getCal(), status: document.querySelector('#status').innerText }));
  ok(legacy.cal && legacy.cal.Q && Math.abs(legacy.cal.Q.tx + 0.04) < 1e-9 || /Calibration ON/.test(legacy.status), 'legacy saved correction migrated to the v3 calibration');
  await p.evaluate(() => { (localStorage.clear(), window.name = ''); }); await p.reload(); await new Promise(r => setTimeout(r, 600));
  const enter = async (rd, code) => { await p.evaluate((code) => { const s = document.querySelector('#calCode'); if (code) s.value = code; }, code);
    for (const [id, [x, y]] of Object.entries(rd)) for (const [a, v] of [['x', x], ['y', y]]) { await p.click(`input[data-t=${id}][data-a=${a}]`, { clickCount: 3 }); await p.keyboard.press('Backspace'); await p.type(`input[data-t=${id}][data-a=${a}]`, String(v)); } };
  // ---- pass 1: synthetic readings from an uncorrected sheet, ruler 7.80 in ----
  await p.click('.tabs button[data-tab=tabCal]'); await new Promise(r => setTimeout(r, 300));
  const codes = await p.evaluate(() => Array.from(document.querySelectorAll('#calCode option')).map(o => [o.value, o.textContent]));
  await enter(PASS1, 'none'); await p.type('#rulerX', '7.80');
  await p.click('#calCompute'); await new Promise(r => setTimeout(r, 800));
  const v1 = await p.evaluate(() => ({ text: document.querySelector('#verdict').innerText, st: window.CST.lastResult.v.status, v: window.CST.lastResult.v, wiz: document.querySelector('#wizard').innerText }));
  await p.screenshot({ path: path.join(OUT, 'ui_calibrate_tab.png'), fullPage: true });
  ok(v1.st === 'needs-choice', `pass 1 verdict asks for a choice (got ${v1.st})`);
  ok(/shrink/i.test(v1.text) && /Recommended: \(a\)/.test(v1.text) && /Printing Preferences/.test(v1.text) && /Fit to Page/.test(v1.text), 'verdict names the shrink, recommends (a) compensate, mentions printer driver settings');
  ok(Math.abs(v1.v.shrinkX - WORLD.shrinkX) < 0.002 && Math.abs(v1.v.shrinkY - WORLD.shrinkY) < 0.002, `fitted shrink ${(v1.v.shrinkX * 100).toFixed(2)}% / ${(v1.v.shrinkY * 100).toFixed(2)}%`);
  // ---- choose (a) ----
  await p.click('#chooseComp'); await new Promise(r => setTimeout(r, 500));
  const afterA = await p.evaluate(() => { const c = window.CST.getCal(); return { ex: c.ex, ey: c.ey, mode: c.mode, Q: c.Q, applyCorr: window.CST.S.applyCorr, verdict: document.querySelector('#verdict').innerText, wiz: document.querySelector('#wizard').innerText, now: document.querySelector('#corrNow').innerText, status: document.querySelector('#status').innerText }; });
  ok(afterA.mode === 'compensate' && afterA.ex > 1.025 && afterA.ey > 1.027 && afterA.applyCorr, `compensation saved +${((afterA.ex - 1) * 100).toFixed(2)}% / +${((afterA.ey - 1) * 100).toFixed(2)}%, calibration applied`);
  // ---- pass 2 files ----
  const files = await p.evaluate(() => ({ svg: window.CST.buildCalSVG(), pdf: window.CST.buildCalPDF().output('datauristring'), code: window.CST.getCal().lastIssued, corr: window.CST.getCorr() }));
  fs.writeFileSync(path.join(OUT, 'calibration-letter-CUT_pass2_compensated_example.svg'), files.svg);
  fs.writeFileSync(path.join(OUT, 'calibration-letter-PRINT_pass2_compensated_example.pdf'), Buffer.from(files.pdf.split(',')[1], 'base64'));
  ok(new RegExp('sheet code ' + files.code).test(files.svg), `pass-2 SVG carries sheet code ${files.code}`);
  const sxCut = Math.hypot(files.corr.a11, files.corr.a21), syCut = Math.hypot(files.corr.a12, files.corr.a22);
  ok(Math.abs(sxCut - 1) < 0.004 && Math.abs(syCut - 1) < 0.004, `cut correction is now ~no scale (${((sxCut - 1) * 100).toFixed(2)}% / ${((syCut - 1) * 100).toFixed(2)}%), only rotation/shift`);
  // simulated physical pass 2: ink = printer(PDF position = printMap(design)), cut = cutter(SVG position)
  const W = 8.5, H = 11, cx = W / 2, cy = H / 2, th = WORLD.rotDeg * Math.PI / 180, a = 1.15;
  const targets = [['T1', a, a], ['T2', W - a, a], ['T3', cx, cy], ['T4', a, H - a], ['T5', W - a, H - a]];
  const svgT = subpaths(dpath(files.svg)).slice(4).map(ctr), r2 = {};
  targets.forEach(([id, x, y], i) => { const yx = cx + afterA.ex * (x - cx), yy = cy + afterA.ey * (y - cy), ink = [cx + (1 - WORLD.shrinkX) * (yx - cx), cy + (1 - WORLD.shrinkY) * (yy - cy)];
    const [fx, fy] = svgT[i], dx = fx - cx, dy = fy - cy, k = [cx + Math.cos(th) * dx - Math.sin(th) * dy + WORLD.matOff[0] / MM, cy + Math.sin(th) * dx + Math.cos(th) * dy + WORLD.matOff[1] / MM];
    const n = ((i * 7919) % 5 - 2) * 0.05; r2[id] = [Math.round(((k[0] - ink[0]) * MM + n) * 4) / 4, Math.round(((k[1] - ink[1]) * MM - n) * 4) / 4]; });
  await p.evaluate(() => { document.querySelector('#rulerX').value = ''; document.querySelector('#rulerY').value = ''; });
  await p.type('#rulerX', String((8 * (1 - WORLD.shrinkX) * afterA.ex).toFixed(3))); await p.type('#rulerY', String((10.5 * (1 - WORLD.shrinkY) * afterA.ey).toFixed(3)));
  await p.evaluate(() => window.CST.renderCalTable()); await enter(r2, files.code);
  await p.click('#calCompute'); await new Promise(r => setTimeout(r, 800));
  const v2 = await p.evaluate(() => ({ text: document.querySelector('#verdict').innerText, st: window.CST.lastResult.v.status, worst: window.CST.lastResult.v.worst, wiz: document.querySelector('#wizard').innerText }));
  await p.screenshot({ path: path.join(OUT, 'ui_calibrate_tab_pass2.png'), fullPage: true });
  ok(v2.st === 'calibrated', `pass 2 verdict "${v2.st}" (worst reading ${(v2.worst * MM).toFixed(2)} mm; readings ${JSON.stringify(r2)})`);
  // ---- a bad reading is flagged ----
  const bad = JSON.parse(JSON.stringify(r2)); bad.T4[0] += 3; await enter(bad, files.code); await p.click('#calCompute'); await new Promise(r => setTimeout(r, 800));
  const v3 = await p.evaluate(() => ({ text: document.querySelector('#verdict').innerText, st: window.CST.lastResult.v.status }));
  ok(v3.st === 'bad-reading' && /T4/.test(v3.text), `3 mm mis-read on T4 is flagged (${v3.st})`);
  await b.close();
  ok(!errs.length, 'no page errors: ' + JSON.stringify(errs));
  console.log(JSON.stringify({ codesOffered: codes, pass1Verdict: v1.text, afterChoice: afterA.verdict, wizardAfterChoice: afterA.wiz, corrNow: afterA.now, pass2Verdict: v2.text, badVerdict: v3.text, dialogs, pass2Code: files.code, comp: [afterA.ex, afterA.ey] }, null, 1));
  process.exit(fails ? 1 : 0);
})();
