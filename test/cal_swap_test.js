// Pass on the uncompensated new-layout sheet (identity code EMQ2), synthetic readings with T1 typed X/Y swapped. Outlier verdict must offer a way forward and spot the swap;
// and a calibration saved by the previous version (old layout sheet records) must survive the layout change.
const puppeteer = require('puppeteer-core'), path = require('path'); const R = path.resolve(__dirname, '..');
const SWAPPED = { T1: [-5.5, -2.25], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; }; const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage(); await p.setViewport({ width: 1300, height: 1000 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload(); await wait(500);
  const code = await p.evaluate(() => { window.CST.buildCalSVG(); return window.CST.getCal().lastIssued; }); ok(code === 'EMQ2', 'uncompensated new-layout sheet code is EMQ2 (unchanged)');
  await p.click('.tabs button[data-tab=tabCal]'); await wait(300);
  const enter = async (rd) => { await p.select('#calCode', code); for (const [id, [x, y]] of Object.entries(rd)) for (const [a, v] of [['x', x], ['y', y]]) { const s = `input[data-t=${id}][data-a=${a}]`; await p.$eval(s, e => e.value = ''); await p.type(s, String(v)); } };
  const verdict = () => p.evaluate(() => ({ st: window.CST.lastResult.v.status, v: window.CST.lastResult.v, text: document.querySelector('#verdict').innerText, btns: Array.from(document.querySelectorAll('#verdict button')).map(b => b.innerText) }));
  await enter(SWAPPED); await p.type('#rulerX', '7.80'); await p.type('#rulerY', '10.21'); await p.click('#calCompute'); await wait(400);
  let v = await verdict(); console.log(v.text);
  ok(v.st === 'bad-reading' && v.v.bad[0] === 'T1', `as entered: still flagged as an outlier, now naming T1 (status ${v.st}, ${v.v.bad})`);
  ok(/Looks like X and Y were swapped at T1/.test(v.text) && v.btns.some(t => /Re-enter T1/.test(t)) && v.btns.some(t => /Drop T1 and save/.test(t)) && v.btns.some(t => /Use anyway/.test(t)) && v.btns.some(t => /Use X -2.25, Y -5.50 for T1/.test(t)), 'swap hint + Re-enter / Drop / Use anyway / use-swapped buttons offered');
  await p.screenshot({ path: path.join(R, 'sample_output', 'ui_cal_swap_hint.png'), fullPage: true });
  // Use anyway -> not a dead end
  await p.click('#useAnyway'); await wait(400); v = await verdict(); ok(v.st === 'needs-choice' && /Saved using all 5/.test(v.text), `Use anyway -> ${v.st}`);
  // Drop T1 -> 4-target fit
  await p.click('#calCompute'); await wait(300); await p.click('#verdict [data-drop=T1]'); await wait(400); v = await verdict(); ok(v.st === 'needs-choice' && /T1 was left out/.test(v.text), `Drop T1 -> ${v.st}, shrink ${(v.v.shrinkX * 100).toFixed(2)}%/${(v.v.shrinkY * 100).toFixed(2)}%`);
  // apply the swap
  await p.click('#calCompute'); await wait(300); await p.click('#applyFix'); await wait(500); v = await verdict();
  const t1 = await p.evaluate(() => [document.querySelector('input[data-t=T1][data-a=x]').value, document.querySelector('input[data-t=T1][data-a=y]').value]);
  ok(v.st === 'needs-choice' && t1.join() === '-2.25,-5.5' && v.v.misMax * 25.4 < 0.2 && Math.abs(v.v.shrinkX - 0.0262) < 0.0005 && Math.abs(v.v.shrinkY - 0.0288) < 0.0005 && Math.abs(v.v.compX - 0.0269) < 0.0006 && Math.abs(v.v.compY - 0.0297) < 0.0006,
    `swap applied: T1 = ${t1}, misfit ≤ ${(v.v.misMax * 25.4).toFixed(2)} mm, shrink ${(v.v.shrinkX * 100).toFixed(2)}%/${(v.v.shrinkY * 100).toFixed(2)}%, comp +${(v.v.compX * 100).toFixed(2)}%/+${(v.v.compY * 100).toFixed(2)}%`);
  // a 3 mm single mis-read is still caught
  await enter(Object.assign({}, { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-0.75, 0.75], T5: [0.25, 2] })); await p.click('#calCompute'); await wait(400); v = await verdict();
  ok(v.st === 'bad-reading' && v.v.bad[0] === 'T4', `3 mm mis-read on T4 still flagged (${v.st} ${v.v.bad})`);
  // previous-version calibration (old-layout sheet records, compensation +2.62/+2.88) survives the layout change
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = '';
    localStorage.setItem('cst.cal.letter-P', JSON.stringify({ v: 3, Q: { v: 2, a11: 0.9745, a12: 0.0050, a21: -0.0050, a22: 0.9720, tx: -0.060, ty: -0.080 }, ex: 1.0262, ey: 1.0288, mode: 'compensate', pass: 2, status: 'verify',
      issued: { KGKF: { Q: { v: 2, a11: 1, a12: 0, a21: 0, a22: 1, tx: 0, ty: 0 }, ex: 1, ey: 1, mode: null, t: Date.now() - 7200e3 } }, lastIssued: 'KGKF', history: [] })); });
  await p.reload(); await wait(600); await p.click('.tabs button[data-tab=tabCal]'); await wait(300);
  const k = await p.evaluate(() => ({ c: window.CST.getCal(), code: window.CST.stateCode(window.CST.currentState()), line: document.querySelector('#calLoaded').innerText, wiz: document.querySelector('#wizard').innerText, now: document.querySelector('#corrNow').innerText }));
  ok(Math.abs(k.c.ex - 1.0262) < 1e-9 && k.code !== 'EMQ2' && /compensation \+2\.62%\/\+2\.88%/.test(k.line) && /layout changed/.test(k.wiz), `old-version calibration kept after the layout change: ${k.line} | next code ${k.code}`);
  await b.close(); ok(!errs.length, 'no page errors ' + JSON.stringify(errs)); process.exit(fails ? 1 : 0);
})();
