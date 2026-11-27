// Calibration persistence on a real file:// page in headless Chrome: refresh, browser restart, lost storage, blocked storage,
// moved HTML file, Export/Import calibration, and calibration inside the project file.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), os = require('os');
const R = path.resolve(__dirname, '..'), HTML = path.join(R, 'index.html');
const PASS1 = { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms)), tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
async function launch(profile) { return puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', userDataDir: profile, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-features=WebShare'] }); }
async function open(b, url, dl, pre) { const p = await b.newPage(); await p.setViewport({ width: 1300, height: 1000 }); if (pre) await p.evaluateOnNewDocument(pre);
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  if (dl) { const cdp = await p.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }); }
  await p.goto(url); await wait(600); return p; }
const state = (p) => p.evaluate(() => { const c = window.CST.getCal(); return { ex: c.ex, ey: c.ey, mode: c.mode, pass: c.pass, status: c.status, issued: Object.keys(c.issued || {}), hist: (c.history || []).length, savedAt: c.savedAt,
  code: window.CST.stateCode(window.CST.currentState()), apply: window.CST.S.applyCorr, line: document.querySelector('#calLoaded').innerText, layoutLine: document.querySelector('#status').innerText,
  inputs: Array.from(document.querySelectorAll('#caltable input')).map(i => i.value).join(','), ruler: document.querySelector('#rulerX').value, sel: document.querySelector('#calCode').value }; });
const calTab = async (p) => { await p.click('.tabs button[data-tab=tabCal]'); await wait(300); };
(async () => {
  const prof = tmp('cstprof-'), dl = tmp('cstdl-'), url = 'file://' + HTML;
  let b = await launch(prof), p = await open(b, url, dl);
  await p.evaluate(() => { localStorage.clear(); window.name = ''; }); await p.reload(); await wait(500); await calTab(p);
  ok(/No saved calibration for Letter/.test(await p.$eval('#calLoaded', e => e.innerText)), 'fresh page says no saved calibration yet');
  await p.select('#calCode', 'none'); for (const [id, [x, y]] of Object.entries(PASS1)) { await p.type(`input[data-t=${id}][data-a=x]`, String(x)); await p.type(`input[data-t=${id}][data-a=y]`, String(y)); }
  await p.type('#rulerX', '7.80'); await p.click('#calCompute'); await wait(400); await p.click('#chooseComp'); await wait(400);
  await p.click('#wizard [data-dl=pdf]'); await wait(700); await p.click('#wizard [data-dl=svg]'); await wait(700);
  // half-typed pass-2 readings must survive too
  await p.evaluate(() => window.CST.renderCalTable()); await p.$$eval('#caltable input', is => is.forEach(i => i.value = '')); await p.type('input[data-t=T1][data-a=x]', '-0.5'); await p.type('input[data-t=T1][data-a=y]', '0.25');
  await p.$eval('#rulerX', e => e.value = ''); await p.type('#rulerX', '8.00');
  const s0 = await state(p); console.log('before refresh', JSON.stringify(s0));
  const same = (s, what) => ok(Math.abs(s.ex - s0.ex) < 1e-12 && Math.abs(s.ey - s0.ey) < 1e-12 && s.mode === 'compensate' && s.pass === s0.pass && s.issued.join() === s0.issued.join() && s.hist === s0.hist && s.code === s0.code && s.apply === true,
    `${what}: fit, compensation ${((s.ex - 1) * 100).toFixed(2)}%/${((s.ey - 1) * 100).toFixed(2)}%, mode, pass ${s.pass}, sheet codes [${s.issued}], history restored`);
  const sameDraft = (s, what) => ok(s.inputs.startsWith('-0.5,0.25') && s.ruler === '8.00' && s.sel === s0.sel, `${what}: typed readings, ruler and picked sheet code restored`);
  // 1) plain refresh of the file:// page
  await p.reload(); await wait(600); await calTab(p); let s = await state(p); same(s, 'refresh'); sameDraft(s, 'refresh');
  ok(/^Calibration loaded: Letter, compensation \+2\.56%\/\+2\.87%, mode compensate, pass 1, saved \d+\/\d+,? \d+:\d\d/.test(s.line), 'status line: ' + s.line);
  ok(/Calibration loaded: Letter/.test(s.layoutLine), 'Layout tab status shows it too');
  // 5) Export calibration
  await p.click('#calExport'); await wait(800);
  const exp = fs.readdirSync(dl).find(f => /^cricut-calibration-letter-P-\w{4}-\d{4}-\d\d-\d\d\.json$/.test(f)); ok(!!exp, 'Export calibration downloaded ' + exp);
  const ej = JSON.parse(fs.readFileSync(path.join(dl, exp))); ok(ej.kind === 'calibration' && ej.cal['cst.cal.letter-P'] && Math.abs(ej.cal['cst.cal.letter-P'].ex - s0.ex) < 1e-12 && ej.cal['cst.draft.letter-P'], `export holds fit+compensation+history+readings (${fs.statSync(path.join(dl, exp)).size} bytes)`);
  // project file includes it
  await p.evaluate(() => document.querySelector('#saveProj').click()); await wait(800);
  const pj = JSON.parse(fs.readFileSync(path.join(dl, 'cricut-sheet-project.json'))); ok(pj.calibration && pj.calibration['cst.cal.letter-P'] && Math.abs(pj.calibration['cst.cal.letter-P'].ex - s0.ex) < 1e-12, 'Save project includes the calibration');
  // save a copy of the tool with the calibration built in
  await p.click('#calSaveTool'); await wait(1500);
  const toolCopy = fs.readdirSync(dl).find(f => /^cricut_print_assistant-calibrated-\w{4}\.html$/.test(f)); ok(!!toolCopy, 'Save tool with my calibration built in downloaded ' + toolCopy);
  // 2) close and restart the browser (same profile)
  await b.close(); b = await launch(prof); p = await open(b, url, dl); await calTab(p); s = await state(p); same(s, 'browser restart'); sameDraft(s, 'browser restart');
  // 3) storage lost while the tab stays open, then refresh -> restored from the tab backup
  await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(600); await calTab(p); s = await state(p); same(s, 'storage cleared + refresh (same tab)');
  ok(/restored from this tab/.test(s.line), 'status says it was restored from the tab backup');
  // 4) the HTML moved to another folder (same browser)
  const moved = path.join(tmp('cstmoved-'), 'my cricut tool.html'); fs.copyFileSync(HTML, moved);
  const p2 = await open(b, 'file://' + moved, dl); await calTab(p2); s = await state(p2);
  ok(/^Calibration loaded/.test(s.line), 'moved/renamed HTML file in the same Chrome profile: ' + s.line.slice(0, 70) + ' (Chrome shares storage between local files; other browsers may not)');
  await p2.close(); await p.bringToFront();
  await b.close();
  // 5b) that copy opened from another folder in a brand-new profile loads its calibration by itself
  { const where = path.join(tmp('cstcopy-'), 'tool.html'); fs.copyFileSync(path.join(dl, toolCopy), where);
    const bb = await launch(tmp('cstprof5-')), pp = await open(bb, 'file://' + where, dl); await calTab(pp); const sc = await state(pp);
    same(sc, 'tool copy with calibration built in, new folder + new profile'); ok(/from the copy built into this HTML file/.test(sc.line) && !pp.errs.length, 'status: ' + sc.line + ' errors ' + JSON.stringify(pp.errs));
    await pp.reload(); await wait(600); await calTab(pp); const sd = await state(pp); ok(Math.abs(sd.ex - s0.ex) < 1e-12 && /^Calibration loaded/.test(sd.line), 'and keeps it after a refresh');
    await bb.close(); }
  // 6) brand-new browser profile (= cleared cache / other PC): Import calibration
  b = await launch(tmp('cstprof2-')); p = await open(b, url, dl); await calTab(p);
  ok(/No saved calibration/.test(await p.$eval('#calLoaded', e => e.innerText)), 'new profile starts empty');
  const [fc] = await Promise.all([p.waitForFileChooser(), p.click('#calImport')]); await fc.accept([path.join(dl, exp)]); await wait(800);
  s = await state(p); same(s, 'Import calibration in a new profile'); sameDraft(s, 'Import calibration');
  ok(/^Calibration imported: Letter, compensation \+2\.56%\/\+2\.87%/.test(s.line), 'status after import: ' + s.line);
  await b.close();
  // 7) new profile: Load project restores calibration
  b = await launch(tmp('cstprof3-')); p = await open(b, url, dl);
  const [fc2] = await Promise.all([p.waitForFileChooser(), p.click('#loadProj')]); await fc2.accept([path.join(dl, 'cricut-sheet-project.json')]); await wait(1200); await calTab(p);
  s = await state(p); ok(Math.abs(s.ex - s0.ex) < 1e-12 && s.mode === 'compensate', 'Load project in a new profile restores the calibration');
  await b.close();
  // 8) storage blocked (setItem throws): warning shown, still survives a refresh in the tab
  b = await launch(tmp('cstprof4-')); p = await open(b, url, dl, () => { Storage.prototype.setItem = function () { throw new Error('blocked'); }; });
  await calTab(p); const [fc3] = await Promise.all([p.waitForFileChooser(), p.click('#calImport')]); await fc3.accept([path.join(dl, exp)]); await wait(700);
  await p.reload(); await wait(600); await calTab(p); s = await state(p);
  ok(Math.abs(s.ex - s0.ex) < 1e-12 && /not keeping data/.test(s.line), 'blocked storage: warning shown, calibration survives a refresh via the tab backup');
  await b.close();
  ok(true, 'page errors: ' + JSON.stringify(p.errs || []));
  process.exit(fails ? 1 : 0);
})();
