// Mockup "Send to Layout": the Layout image list becomes exactly the Layers list (qty = layer copies, same sizes, others removed;
// hidden layers excluded by default / included with the checkbox), confirm dialog with a summary, one undo step, Layout tab + auto-pack,
// and the print PDF / cut SVG equal a Layout set up by hand with just those images. Calibration / sheet code untouched.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
const HELP = () => { const C = window.CST; window.T = {
  exports: () => { C.computeLayout(); const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD;
    try { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); const u = new Uint8Array(d.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return { pdf: btoa(s), svgs: C.buildSVGs(), code: C.stateCode(C.currentState()) }; } finally { window.Date = RD; } },
  items: () => C.items.map(i => ({ name: i.name, qty: i.qty, w: i.wIn, h: i.hIn })),
  placed: () => { const m = {}; C.layout.sheets.flat().forEach(e => m[e.it.name] = (m[e.it.name] || 0) + 1); return m; },
  nodes: (nm) => C.MK.nodes.filter(n => { const it = C.items.find(i => i.id === n.itemId); return it && it.name === nm; }) }; };
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  const fresh = async (pg, files) => { await pg.goto('file://' + R + '/index.html'); await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await pg.reload();
    await (await pg.$('#file')).uploadFile(...files.map(f => path.join(SC, f))); await pg.waitForFunction((n) => window.CST.items.length === n, { timeout: 20000 }, files.length);
    await pg.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500); await pg.evaluate(HELP); };
  await fresh(p, FILES);
  const T = (f, ...a) => p.evaluate(f, ...a);
  const code0 = (await T(() => window.T.exports())).code, cal0 = await T(() => JSON.stringify(window.CST.currentState()));
  // Layout state before: odd quantities + hand-placed pins
  await T(() => { const C = window.CST, it = (n) => C.items.find(i => i.name === n); it('wall_panel.png').qty = 4; it('rug.png').qty = 3; C.refresh(true); }); await wait(600);
  await T(() => { window.CST.pinLayout(); window.CST.refresh(false); }); await wait(500);
  ok(await T(() => !!window.CST.manual), 'before: Layout has hand-placed pins');
  // Mockup: 3 sofas (1 hidden), 2 bears (1 flipped), rug + floor boards removed from the layers, window hidden, lamp resized here
  await p.click('[data-tab=tabMock]'); await wait(800);
  await T(() => { const C = window.CST, T = window.T, click = (s) => document.querySelector(s).click();
    C.mkSelect(T.nodes('sofa.png')[0]); click('#mkDup'); C.mkSelect(T.nodes('sofa.png')[0]); click('#mkDup');
    C.mkSelect(T.nodes('bear_headset.png')[0]); click('#mkDup'); C.mkSelect(T.nodes('bear_headset.png')[1]); click('#mkFlip');
    C.mkSelect(T.nodes('rug.png')[0]); click('#mkDel'); C.mkSelect(T.nodes('floor_boards.png')[0]); click('#mkDel'); });
  await wait(300);
  await T(() => { const C = window.CST, T = window.T; T.nodes('window.png')[0].hidden = true; T.nodes('sofa.png')[2].hidden = true; C.renderMock(true); C.mkSetSize(C.items.find(i => i.name === 'floor_lamp.png'), 1.2, 2.6); });
  await wait(1500);
  const sizes = await T(() => Object.fromEntries(window.CST.items.map(i => [i.name, [i.wIn, i.hIn]])));
  ok(Math.abs(sizes['floor_lamp.png'][0] - 1.2) < 1e-9, 'lamp resized in the mockup to 1.2 × 2.6 in');
  const before = await T(() => ({ items: window.T.items(), manual: JSON.stringify(window.CST.manual) }));
  // open the dialog; Cancel changes nothing
  await p.click('#mkSend'); await wait(300);
  const dlg = await T(() => ({ open: document.querySelector('#mkSendDlg').open, sum: document.querySelector('#mkSendSum').textContent, list: [...document.querySelectorAll('#mkSendList li')].map(l => l.textContent), note: document.querySelector('#mkSendNote').textContent }));
  ok(dlg.open, 'Send to Layout… opens a confirm dialog');
  ok(/^Layout will have 4 images, 6 pieces; 2 images removed; 1 image set to qty 0 \(only hidden layers\); \d+ quantit(y|ies) changed\.$/.test(dlg.sum), `summary: "${dlg.sum}"`);
  ok(dlg.list.length === 7 && dlg.list.some(t => /^sofa\.png × 2/.test(t)) && dlg.list.some(t => /^floor_lamp\.png × 1 · 1\.2 in × 2\.6 in/.test(t)) && dlg.list.some(t => /^rug\.png · removed/.test(t)), 'list: kept images with counts and sizes, qty-0 and removed ones');
  ok(/2 hidden layers not counted/.test(dlg.note) && /reset/.test(dlg.note) && /rotation/.test(dlg.note) && /1 flipped piece will print unflipped/.test(dlg.note), `note: "${dlg.note}"`);
  await p.screenshot({ path: path.join(OUT, 'ui_mockup_send_dialog.png') });
  await p.click('#mkSendCancel'); await wait(300);
  ok(await T((b) => !document.querySelector('#mkSendDlg').open && JSON.stringify(window.T.items()) === JSON.stringify(b.items) && JSON.stringify(window.CST.manual) === b.manual, before), 'Cancel: nothing changed');
  // send (hidden excluded)
  await p.click('#mkSend'); await wait(300); await p.click('#mkSendOk'); await wait(1500);
  let st = await T(() => ({ tab: document.querySelector('#tabLayout').style.display !== 'none', manual: window.CST.manual, items: window.T.items(), placed: window.T.placed() }));
  ok(st.tab, 'switched to the Layout tab');
  ok(st.manual === null, 'hand-placed pins reset: auto-pack');
  const want1 = { 'wall_panel.png': 1, 'window.png': 0, 'sofa.png': 2, 'floor_lamp.png': 1, 'bear_headset.png': 2 };
  ok(JSON.stringify(st.items.map(i => [i.name, i.qty])) === JSON.stringify(Object.entries(want1)), 'Layout list = the layer images, qty = visible copies (window kept at qty 0: only a hidden layer); rug + floor boards removed: ' + JSON.stringify(st.items.map(i => [i.name, i.qty])));
  ok(st.items.every(i => Math.abs(i.w - sizes[i.name][0]) < 1e-12 && Math.abs(i.h - sizes[i.name][1]) < 1e-12), 'sizes unchanged (mockup size of the lamp carried over)');
  ok(JSON.stringify(st.placed) === JSON.stringify({ 'wall_panel.png': 1, 'sofa.png': 2, 'floor_lamp.png': 1, 'bear_headset.png': 2 }) || Object.entries(want1).every(([k, v]) => (st.placed[k] || 0) === v), 'cut sheet holds exactly those 6 pieces: ' + JSON.stringify(st.placed));
  ok(await T(() => document.querySelectorAll('#items .item').length) === 5, 'Layout shows 5 image cards');
  const eSent = await T(() => window.T.exports());
  ok(eSent.code === code0 && await T(() => JSON.stringify(window.CST.currentState())) === cal0, 'calibration and sheet code unchanged');
  await p.screenshot({ path: path.join(OUT, 'ui_layout_after_send.png') });
  // reference: the same images/sizes/qty set up by hand on the Layout tab in a fresh page -> identical PDF and SVG
  const p2 = await b.newPage(); await p2.setViewport({ width: 1500, height: 1100 }); p2.on('pageerror', e => errs.push('ref: ' + e.message));
  await fresh(p2, Object.keys(want1));
  await p2.evaluate((sz, q) => { const C = window.CST; C.items.forEach(i => { i.wIn = sz[i.name][0]; i.hIn = sz[i.name][1]; i.pct = C.pctOf(i); i.qty = q[i.name]; }); C.refresh(true); }, sizes, want1); await wait(1500);
  const eRef = await p2.evaluate(() => window.T.exports());
  const pieceCount = (svgs) => svgs.join('').split('<path').length - 1;
  ok(eSent.svgs.join('\n') === eRef.svgs.join('\n'), `cut SVG identical to a Layout made by hand with just those pieces (${eSent.svgs.length} sheet(s))`);
  ok(eSent.pdf === eRef.pdf, 'print PDF identical to that hand-made Layout (frozen clock + fixed PDF ID)');
  await p2.close();
  const txt = (pdf) => { const f = path.join(require('os').tmpdir(), 'send.pdf'); fs.writeFileSync(f, Buffer.from(pdf, 'base64')); return execFileSync('pdfinfo', [f]).toString(); };
  ok(/Pages:\s+1/.test(txt(eSent.pdf)), 'print PDF: 1 page');
  // undo / redo (Layout undo)
  await T(() => window.CST.undo()); await wait(1500);
  st = await T(() => ({ items: window.T.items(), manual: JSON.stringify(window.CST.manual) }));
  ok(JSON.stringify(st.items) === JSON.stringify(before.items) && st.manual === before.manual, 'Ctrl+Z on the Layout tab brings back all 7 images, the old quantities and the hand-placed pins');
  await T(() => window.CST.redo()); await wait(1500);
  ok(JSON.stringify((await T(() => window.T.items())).map(i => [i.name, i.qty])) === JSON.stringify(Object.entries(want1)), 'redo re-applies the send');
  await T(() => window.CST.undo()); await wait(1500);
  // include hidden layers
  await p.click('[data-tab=tabMock]'); await wait(800);
  await p.click('#mkSendHidden'); await p.click('#mkSend'); await wait(300);
  const sum2 = await T(() => document.querySelector('#mkSendSum').textContent);
  ok(/^Layout will have 5 images, 8 pieces; 2 images removed;/.test(sum2), `with hidden layers: "${sum2}"`);
  await p.click('#mkSendOk'); await wait(1500);
  st = await T(() => ({ items: window.T.items(), placed: window.T.placed() }));
  ok(JSON.stringify(st.items.map(i => [i.name, i.qty])) === JSON.stringify([['wall_panel.png', 1], ['window.png', 1], ['sofa.png', 3], ['floor_lamp.png', 1], ['bear_headset.png', 2]]) && Object.values(st.placed).reduce((a, b) => a + b, 0) === 8, 'Include hidden layers: window ×1, sofa ×3 (8 pieces on the sheet)');
  // mockup still intact afterwards
  await p.click('[data-tab=tabMock]'); await wait(800);
  ok(await T(() => window.CST.MK.nodes.length === 8 && window.CST.MK.nodes.every(n => window.CST.items.some(i => i.id === n.itemId))), 'mockup layers unchanged and all still linked after the send');
  // nothing to send
  await T(() => { window.CST.MK.nodes.forEach(n => n.hidden = true); window.CST.renderMock(true); document.querySelector('#mkSendHidden').checked = false; }); await p.click('#mkSend'); await wait(300);
  ok(await T(() => document.querySelector('#mkSendOk').disabled && /Nothing to send/.test(document.querySelector('#mkSendSum').textContent)), 'all layers hidden: "Nothing to send", Send disabled');
  await p.click('#mkSendCancel');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
