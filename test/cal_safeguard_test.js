// Scenario (synthetic readings): a second pass is read off an old sheet with code KGKF = the uncompensated, uncorrected state (old ±4 mm layout).
// Checks: KGKF is the identity code; the real download path gives code-named files whose PDF is enlarged and says so;
// picking an older sheet code gives a plain "this sheet was made without your compensation" verdict and saves nothing;
// a compensated code whose paper is still short is caught as "compensation didn't reach the paper" (no compounding adjust);
// and a state saved by the previous version's "retry + Adjust" path verifies on a correct next pass.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), MM = 25.4, DL = fs.mkdtempSync('/tmp/cstdl-');
const PASS1 = { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
const PASS2_OLD_SHEET = { T1: [-3, -5], T2: [1.25, -3.75], T3: [-1.75, -1.25], T4: [-4.5, 1.25], T5: [-0.5, 2.5] };
const WORLD = { shrinkX: 0.0255, shrinkY: 0.028, rotDeg: 0.4, matOff: [-0.95, -1.85] };
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage(); await p.setViewport({ width: 1300, height: 1000 });
  const cdp = await p.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => (localStorage.clear(), window.name = '')); await p.reload(); await wait(500);
  const ID = await p.evaluate(() => window.CST.stateCode(window.CST.currentState()));
  ok(await p.evaluate(() => CSTCore.calCode(CSTCore.IDENTITY, 1, 1)) === 'KGKF' && ID !== 'KGKF', `KGKF is the code of the uncalibrated state on the old (±4 mm) sheets; new ±8 mm uncalibrated sheets are ${ID}`);
  const enter = async (rd, code) => { await p.select('#calCode', code);
    for (const [id, [x, y]] of Object.entries(rd)) for (const [a, v] of [['x', x], ['y', y]]) { const sel = `input[data-t=${id}][data-a=${a}]`; await p.$eval(sel, e => e.value = ''); await p.type(sel, String(v)); } };
  const ruler = async (x, y) => { await p.$eval('#rulerX', e => e.value = ''); await p.$eval('#rulerY', e => e.value = ''); if (x) await p.type('#rulerX', String(x)); if (y) await p.type('#rulerY', String(y)); };
  await p.click('.tabs button[data-tab=tabCal]'); await wait(300);
  // what most likely happened: pass-1 checklist step 1 downloaded first (KGKF), then compute + choose (a)
  await p.click('#wizard [data-dl=pdf]'); await wait(900);
  await enter(PASS1, 'none'); await ruler('7.80'); await p.click('#calCompute'); await wait(400); await p.click('#chooseComp'); await wait(400);
  const st = await p.evaluate(() => { const c = window.CST.getCal(); return { ex: c.ex, ey: c.ey, code: window.CST.stateCode(window.CST.currentState()), wiz: document.querySelector('#wizard').innerText }; });
  ok(/Use only files with sheet code/.test(st.wiz) && new RegExp(ID + ' are out of date').test(st.wiz), `after choosing, the checklist says use only ${st.code} and that ${ID} files are out of date`);
  const offCode = await p.evaluate(() => { const C = window.CST; C.S.applyCorr = false; const svg = C.buildCalSVG(), code = (svg.match(/sheet code (\w+)/) || [])[1]; C.S.applyCorr = true; return code; });
  ok(offCode === st.code, `with "Apply calibration" switched off the calibration files still carry the calibration (${offCode}, not KGKF)`);
  await p.click('#wizard [data-dl=pdf]'); await wait(900); await p.click('#wizard [data-dl=svg]'); await wait(900);
  const files = fs.readdirSync(DL).sort(); console.log('downloads:', files);
  ok(files.some(f => f.endsWith(`CALIBRATION-${ID}-PRINT.pdf`)) && files.some(f => new RegExp(`CALIBRATION-${st.code}-PRINT\\.pdf$`).test(f)) && files.some(f => new RegExp(`CALIBRATION-${st.code}-CUT\\.svg$`).test(f)), 'downloaded file names carry the sheet code (old and new files can no longer be confused)');
  const txt = (f) => execFileSync('pdftotext', ['-layout', path.join(DL, f), '-']).toString().replace(/\s+/g, ' ');
  const tNew = txt(files.find(f => f.includes(st.code + '-PRINT'))), tOld = txt(files.find(f => f.includes(ID + '-PRINT')));
  ok(/Expected ruler reading on paper: 8\.000 x 10\.500 in · in the PDF itself: 8\.205 x 10\.801 in/.test(tNew) && /COMPENSATION \+2\.56% \/ \+2\.87%/.test(tNew), 'compensated PDF prints the compensation and "on paper 8.000 / in the PDF 8.205" next to the code');
  ok(/COMPENSATION NONE/.test(tOld) && /print compensation NONE/.test(tOld), 'uncompensated (KGKF) PDF says compensation NONE');
  const meas = execFileSync('python3', [path.join(__dirname, 'check_comp_pdf.py')], { env: Object.assign({}, process.env, { PDF: path.join(DL, files.find(f => f.includes(st.code + '-PRINT'))) }) }).toString().trim();
  ok(/PASS/.test(meas), 'downloaded compensated PDF measured: ' + meas.split('\n')[0]);
  // pass-2 readings entered against the sheet that was actually printed (KGKF)
  // the browser also holds a KGKF sheet record from the old version (no layout field = old ±4 mm sheet)
  await p.evaluate(() => { const C = window.CST, c = C.getCal(); c.issued.KGKF = { Q: CSTCore.IDENTITY, ex: 1, ey: 1, mode: null, t: Date.now() - 3600e3 }; C.saveCal(c); C.renderCalTable(); });
  await enter(PASS2_OLD_SHEET, 'KGKF'); await ruler('7.80'); await p.click('#calCompute'); await wait(500);
  const v1 = await p.evaluate(() => ({ st: window.CST.lastResult.v.status, stale: !!window.CST.lastResult.v.stale, text: document.querySelector('#verdict').innerText, ex: window.CST.getCal().ex }));
  ok(v1.stale && /made without any print compensation/.test(v1.text) && Math.abs(v1.ex - st.ex) < 1e-12 && !/Adjust compensation|adjust compensation/.test(v1.text), 'KGKF readings after choosing (a): "this sheet was made without compensation", nothing saved, no adjust button');
  console.log('stale verdict:', v1.text);
  // same readings but the compensated code picked (= the PDF was enlarged but the paper still came out short)
  await enter(PASS2_OLD_SHEET, st.code); await ruler('7.80'); await p.click('#calCompute'); await wait(500);
  const v2 = await p.evaluate(() => ({ st: window.CST.lastResult.v.status, text: document.querySelector('#verdict').innerText, ex: window.CST.getCal().ex }));
  ok(v2.st === 'comp-not-applied' && /didn't reach the paper/.test(v2.text) && Math.abs(v2.ex - st.ex) < 1e-12, `paper still short on a compensated sheet -> ${v2.st}, compensation unchanged`);
  console.log('comp-not-applied verdict:', v2.text);
  // without the ruler it is still caught from the readings alone
  await ruler(''); await p.click('#calCompute'); await wait(500);
  ok(await p.evaluate(() => window.CST.lastResult.v.status) === 'comp-not-applied', 'caught from the readings alone (no ruler)');
  // state saved by the old version, which treated KGKF as a retry + Adjust -> Q fitted from KGKF readings, compensation from 1/qx
  const oldState = await p.evaluate((rd) => { const C = window.CST; (localStorage.clear(), window.name = ''); const r = {}; for (const k in rd) r[k] = { x: rd[k][0], y: rd[k][1] };
    const f = C.computeCalibration(r, 'none'); const c = C.getCal(); c.Q = f.fit.Q; c.ex = 1 / f.fit.q.qx; c.ey = 1 / f.fit.q.qy; c.mode = 'compensate'; c.status = 'verify'; c.pass = 2; C.saveCal(c); C.S.applyCorr = true;
    return { ex: c.ex, ey: c.ey, code: C.stateCode(C.currentState()) }; }, PASS2_OLD_SHEET);
  console.log('old-version state', JSON.stringify(oldState));
  ok(Math.abs(oldState.ex - 1.0256) < 0.0006 && Math.abs(oldState.ey - 1.0281) < 0.0006, `reconstructed the saved compensation +${((oldState.ex - 1) * 100).toFixed(2)}% / +${((oldState.ey - 1) * 100).toFixed(2)}% (expected +2.56 / +2.81)`);
  let v3, sims = [];
  for (let pass = 0; pass < 3; pass++) {
    const sim = await p.evaluate((W) => { const C = window.CST, MMi = 25.4, cx = 4.25, cy = 5.5, th = W.rotDeg * Math.PI / 180, c = C.getCal();
    const svg = C.buildCalSVG(), code = C.getCal().lastIssued, d = /id="cuts"[^>]* d="([^"]+)"/.exec(svg)[1], sp = d.split('Z').filter(x => x.trim()).map(s => { const n = s.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), pts = []; for (let i = 0; i < n.length; i += 2) pts.push([n[i] / 72 + 0.25, n[i + 1] / 72 + 0.25]); return pts; }).slice(4);
    const T = C.calTargets(C.sheetDims()), out = {};
    T.forEach((t, i) => { const f = sp[i].reduce((a, q) => [a[0] + q[0] / sp[i].length, a[1] + q[1] / sp[i].length], [0, 0]), yx = cx + c.ex * (t.x - cx), yy = cy + c.ey * (t.y - cy);
      const ink = [cx + (1 - W.shrinkX) * (yx - cx), cy + (1 - W.shrinkY) * (yy - cy)], dx = f[0] - cx, dy = f[1] - cy, k = [cx + Math.cos(th) * dx - Math.sin(th) * dy + W.matOff[0] / MMi, cy + Math.sin(th) * dx + Math.cos(th) * dy + W.matOff[1] / MMi];
      out[t.id] = [Math.round((k[0] - ink[0]) * MMi * 4) / 4, Math.round((k[1] - ink[1]) * MMi * 4) / 4]; });
    window.CST.renderCalTable(); return { code, out, mark: [8 * c.ex * (1 - W.shrinkX), 10.5 * c.ey * (1 - W.shrinkY)] }; }, WORLD);
    await enter(sim.out, sim.code); await ruler(sim.mark[0].toFixed(3), sim.mark[1].toFixed(3)); await p.click('#calCompute'); await wait(500);
    v3 = await p.evaluate(() => ({ st: window.CST.lastResult.v.status, worst: window.CST.lastResult.v.worst, text: document.querySelector('#verdict').innerText }));
    sims.push(`${sim.code}: ${v3.st} worst ${(v3.worst * 25.4).toFixed(2)} mm`); if (v3.st === 'calibrated') break;

  }
  console.log('next passes from that state:', sims.join(' | '));
  ok(v3.st === 'calibrated' && sims.length <= 2 && !sims.some(x => /comp-not|stale|bad/.test(x)), 'from that saved state: next pass refines placement (paper shift differs ~1 mm between passes), the one after is Calibrated; size stays true');
  await b.close();
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  process.exit(fails ? 1 : 0);
})();
