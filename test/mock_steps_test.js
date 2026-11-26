// Assembly-guide numbering = application order: #1 = the bottom-most visible layer, every copy its own step, hidden layers skipped (contiguous),
// live renumbering on reorder (Layers list too), per-piece number hiding (# toggle + Selected-piece checkbox) in the view, Guide PNG and Guide PDF,
// Numbers: none, number size, undo/redo, autosave + project round trip, and "Print piece numbers" on the cut sheet = the guide's steps
// (copies of one image take its steps in reading order). Cut SVG and sheet code never change.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
const HELP = () => { const C = window.CST; window.T = {
  b64: (doc) => { const u = new Uint8Array(doc.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  frozen: (f) => { const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD; try { return f(); } finally { window.Date = RD; } },
  exports: () => { C.computeLayout(); return window.T.frozen(() => { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); return { pdf: window.T.b64(d), svgs: C.buildSVGs(), code: C.stateCode(C.currentState()) }; }); },
  guidePDF: () => window.T.frozen(() => { const d = C.guidePDF(); d.setFileId('00000000000000000000000000000000'); return window.T.b64(d); }),
  name: (n) => { const it = C.items.find(i => i.id === n.itemId); return it ? it.name : null; },
  nodes: (nm) => C.MK.nodes.filter(n => window.T.name(n) === nm),
  steps: () => { const m = C.mkSteps(); return C.MK.nodes.map(n => [window.T.name(n), m.get(n) || 0, !!n.hidden]); },
  layerNums: () => [...document.querySelectorAll('#mkLayers .lrow')].map(r => [+r.dataset.uid, r.querySelector('.lnum').textContent]),
  // numbers drawn with fillText while rendering (badges + legend circles are the only pure numbers)
  texts: (f) => { const P = CanvasRenderingContext2D.prototype, o = P.fillText, got = []; P.fillText = function (t, ...a) { got.push(String(t)); return o.call(this, t, ...a); }; try { f(); } finally { P.fillText = o; } return got.filter(t => /^\d+$/.test(t)).map(Number); },
  view: () => window.T.texts(() => C.renderMock(true)), png: () => window.T.texts(() => C.guidePNG()) }; };
const pdfText = (b64, f, l) => { const fn = '/tmp/steps_' + Math.random().toString(36).slice(2) + '.pdf'; fs.writeFileSync(fn, Buffer.from(b64, 'base64')); const t = execFileSync('pdftotext', ['-layout', '-f', String(f), '-l', String(l), fn, '-']).toString(); fs.unlinkSync(fn); return t; };
const nums = (t) => (t.match(/\b\d+\b/g) || []).map(Number);
const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);
const sorted = (a) => a.slice().sort((x, y) => x - y);
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('dialog', d => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload();
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction((n) => window.CST.items.length === n, { timeout: 20000 }, FILES.length);
  await p.evaluate(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); C.refresh(true); }); await wait(2500); await p.evaluate(HELP);
  const T = (f, ...a) => p.evaluate(f, ...a);
  const fallback = await T(() => { const C = window.CST, L = C.layout; return { steps: C.mkSteps().size, lab: C.pieceLabels(L.sheets[0], L.sh).map(l => l.t), want: L.sheets[0].map(e => String(C.numOf(e.it))) }; });
  ok(fallback.steps === 0 && JSON.stringify(fallback.lab) === JSON.stringify(fallback.want), `no mockup yet: printed numbers fall back to the image number (${[...new Set(fallback.lab)].join(',')})`);
  const base = await T(() => window.T.exports());

  // scene: 3 sofas, 2 bears, window hidden
  await p.click('[data-tab=tabMock]'); await wait(800);
  await T(() => { const C = window.CST, T = window.T, click = (s) => document.querySelector(s).click();
    C.mkSelect(T.nodes('sofa.png')[0]); click('#mkDup'); C.mkSelect(T.nodes('sofa.png')[0]); click('#mkDup'); C.mkSelect(T.nodes('bear_headset.png')[0]); click('#mkDup');
    T.nodes('window.png')[0].hidden = true; C.mkSelect(null); C.renderMock(true); }); await wait(400);
  let st = await T(() => window.T.steps());
  const vis = st.filter(s => !s[2]), N = vis.length;
  ok(N === 9 && JSON.stringify(vis.map(s => s[1])) === JSON.stringify(seq(N)), `steps follow the layer order bottom → top, contiguous 1..${N}: ${vis.map(s => s[1] + ':' + s[0].replace('.png', '')).join(' ')}`);
  ok(st.filter(s => s[2]).every(s => s[1] === 0), 'hidden layer (window) gets no step and the numbering stays contiguous');
  const sofaSteps = st.filter(s => s[0] === 'sofa.png').map(s => s[1]);
  ok(new Set(sofaSteps).size === 3, `each copy has its own step (sofa ×3 = #${sofaSteps.join(', #')})`);
  const ln = await T(() => { const m = window.CST.mkSteps(); return window.T.layerNums().map(([uid, t]) => { const n = window.CST.MK.nodes.find(x => x.uid === uid); return [t, String(m.get(n) || '–')]; }); });
  ok(ln.every(([a, b]) => a === b) && ln[0][0] === String(N), `Layers list shows each layer's step (front first: ${ln.map(l => l[0]).join(' ')})`);
  // reorder: the top bear goes to the back -> it becomes #1, the rest shift up by one
  const bearUid = await T(() => { const C = window.CST, n = window.T.nodes('bear_headset.png')[1]; C.mkOrder(n, 'back'); return n.uid; }); await wait(300);
  st = await T(() => window.T.steps());
  const ln2 = await T(() => window.T.layerNums());
  ok(st[0][0] === 'bear_headset.png' && st[0][1] === 1 && JSON.stringify(st.filter(s => !s[2]).map(s => s[1])) === JSON.stringify(seq(N)), `after "To back" the bear is #1 and the rest renumber live: ${st.filter(s => !s[2]).map(s => s[1] + ':' + s[0].replace('.png', '')).join(' ')}`);
  ok(ln2[ln2.length - 1][0] === bearUid && ln2[ln2.length - 1][1] === '1', 'Layers list updated: the bottom row shows #1');
  const cardBadge = await T(() => { const it = window.CST.items.find(i => i.name === 'sofa.png'); return document.querySelector(`.inum[data-iid="${it.id}"]`).textContent; });
  const sofa2 = (await T(() => window.T.steps())).filter(s => s[0] === 'sofa.png').map(s => s[1]);
  ok(cardBadge === '#' + sofa2.join(',#'), `Layout card badge shows the image's steps (${cardBadge})`);
  // legend order
  const leg = await T(() => window.CST.legendRows().map(r => [r.n, r.it.name]));
  ok(JSON.stringify(leg.map(r => r[0])) === JSON.stringify(seq(N)) && JSON.stringify(leg.map(r => r[1])) === JSON.stringify(st.filter(s => !s[2]).map(s => s[0])), 'legend = one row per step in order (step, image)');

  // guide mode: view, PNG and PDF show every step once
  await p.select('#mkGuide', 'outline'); await wait(300);
  ok(await T(() => getComputedStyle(document.querySelector('#mkNumRow')).display !== 'none' && document.querySelectorAll('#mkLayers .lnumtog').length === window.CST.MK.nodes.length), 'guide mode: number options + a # toggle on every layer');
  let v = await T(() => window.T.view()), g = await T(() => window.T.png());
  ok(JSON.stringify(sorted(v)) === JSON.stringify(seq(N)), `view draws numbers 1..${N} once each`);
  ok(JSON.stringify(sorted(g)) === JSON.stringify(sorted(seq(N).concat(seq(N)))), 'Guide PNG: every step on the picture + in the legend');
  let pdf = await T(() => window.T.guidePDF());
  ok(JSON.stringify(sorted(nums(pdfText(pdf, 1, 1)))) === JSON.stringify(seq(N)), 'Guide PDF page 1: numbers 1..' + N);
  const t2 = pdfText(pdf, 2, 9);
  const stepLines = [...t2.matchAll(/Step (\d+): (\S+)/g)].map(m => [+m[1], m[2]]);
  ok(JSON.stringify(stepLines) === JSON.stringify(leg), `Guide PDF legend lists "Step n: image" in order (${stepLines.length} rows)`);

  // hide one number with the layer's # toggle (a bear in the middle of the stack)
  const hid = await T(() => { const C = window.CST, n = window.T.nodes('bear_headset.png')[0], k = C.mkSteps().get(n); document.querySelector(`#mkLayers .lrow[data-uid="${n.uid}"] .lnumtog`).click(); return { k, uid: n.uid, noNum: n.noNum }; }); await wait(300);
  v = await T(() => window.T.view()); g = await T(() => window.T.png()); pdf = await T(() => window.T.guidePDF());
  const rest = seq(N).filter(k => k !== hid.k);
  ok(hid.noNum && JSON.stringify(sorted(v)) === JSON.stringify(rest), `# toggle hides #${hid.k} on the canvas; the others stay (${sorted(v).join(',')})`);
  ok(JSON.stringify(sorted(g)) === JSON.stringify(sorted(rest.concat(seq(N)))), `Guide PNG: #${hid.k} gone from the picture, still in the legend`);
  ok(JSON.stringify(sorted(nums(pdfText(pdf, 1, 1)))) === JSON.stringify(rest) && new RegExp(`Step ${hid.k}: bear_headset\\.png[\\s\\S]{0,200}number not shown`).test(pdfText(pdf, 2, 9)), `Guide PDF: #${hid.k} gone from page 1; the legend keeps step ${hid.k} and says its number is not shown`);
  ok(JSON.stringify((await T(() => window.T.steps())).filter(s => !s[2]).map(s => s[1])) === JSON.stringify(seq(N)), 'the hidden number keeps its step (order unchanged)');
  ok(await T(() => document.querySelector(`#mkLayers .lrow[data-uid="${window.T.nodes('bear_headset.png')[0].uid}"] .lnumtog`).classList.contains('off')), 'layer # toggle shows the off state');
  const outl = await T(() => { const C = window.CST, n = window.T.nodes('bear_headset.png')[0], P = Path2D.prototype; let strokes = 0; const o = CanvasRenderingContext2D.prototype.stroke; CanvasRenderingContext2D.prototype.stroke = function (a) { if (a instanceof Path2D) strokes++; return o.apply(this, arguments); }; try { C.renderMock(true); } finally { CanvasRenderingContext2D.prototype.stroke = o; } return strokes; });
  ok(outl === N, `every visible piece still draws its outline (${outl} outlines)`);
  // undo / redo
  await T(() => window.CST.mkUndo()); await wait(200);
  ok(await T(() => !window.T.nodes('bear_headset.png')[0].noNum && JSON.stringify(window.T.view().sort((a, b) => a - b)).split(',').length > 0), 'undo brings the number back');
  v = await T(() => window.T.view()); ok(v.length === N, 'after undo all ' + N + ' numbers show');
  await T(() => window.CST.mkRedo()); await wait(200); v = await T(() => window.T.view()); ok(v.length === N - 1 && !v.includes(hid.k), 'redo hides it again');
  // Selected-piece checkbox
  const sel = await T(() => { const C = window.CST, n = window.T.nodes('sofa.png')[1]; C.mkSelect(n); const cb = document.querySelector('#mkSelNum'), was = cb.checked; cb.click(); return { was, now: n.noNum, k: C.mkSteps().get(n) }; }); await wait(200);
  v = await T(() => window.T.view());
  ok(sel.was && sel.now && !v.includes(sel.k) && v.length === N - 2, `"Show this piece's number" checkbox hides #${sel.k} too (${v.length} numbers left)`);
  // number size
  const sz = await T(async () => { const C = window.CST, a = C.guidePNG(); const el = document.querySelector('#mkNumSize'); el.value = 150; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); return { diff: a !== C.guidePNG(), size: C.MK.num.size }; });
  ok(sz.diff && sz.size === 150, 'number size slider (150%) changes the guide exports');
  await p.evaluate(() => window.scrollTo(0, 0)); await T(() => window.CST.mkSelect(null)); await wait(200);
  await p.screenshot({ path: path.join(OUT, 'ui_mockup_steps.png') });
  // Numbers: none -> legend only
  await p.select('#mkNumShow', 'none'); await wait(300);
  v = await T(() => window.T.view()); g = await T(() => window.T.png()); pdf = await T(() => window.T.guidePDF());
  ok(v.length === 0 && JSON.stringify(sorted(g)) === JSON.stringify(seq(N)) && nums(pdfText(pdf, 1, 1)).length === 0 && [...pdfText(pdf, 2, 9).matchAll(/Step \d+:/g)].length === N, 'Numbers: None → no numbers on the picture (view, PNG, PDF), the legend still lists all steps');
  await T(() => window.CST.mkUndo()); await wait(200); ok(await T(() => window.CST.MK.num.show === 'all'), 'undo restores Numbers: All');
  // autosave + project
  await wait(500);
  const saved = await T(() => JSON.parse(window.CST.STORE.get('cst.mockup')));
  ok(saved.num && saved.num.size === 150 && saved.nodes.filter(n => n.noNum).length === 2, 'autosave keeps the number size and the 2 hidden numbers');
  const proj = await T(async () => { const C = window.CST, o = URL.createObjectURL; let blob = null; URL.createObjectURL = (b) => { blob = b; return o.call(URL, b); }; try { await C.saveProject(); } finally { URL.createObjectURL = o; }
    const txt = await blob.text(); C.MK.nodes.forEach(n => n.noNum = false); C.MK.num.size = 100; await C.loadProject(new File([txt], 'p.json')); await new Promise(r => setTimeout(r, 2500));
    return { size: C.MK.num.size, hid: C.MK.nodes.filter(n => n.noNum).map(n => window.T.name(n)) }; });
  ok(proj.size === 150 && JSON.stringify(proj.hid.sort()) === JSON.stringify(['bear_headset.png', 'sofa.png']), `project round trip keeps number size + hidden numbers (${proj.hid.join(', ')})`);
  await p.evaluate(HELP);

  // cut sheet: Send to Layout, then "Print piece numbers" = the guide's steps
  await p.click('[data-tab=tabMock]'); await wait(600);
  const stepsNow = await T(() => window.T.steps());
  await T(() => { window.CST.mkSendApply(window.CST.mkSendPlan(false)); }); await wait(2500);
  const e0 = await T(() => window.T.exports());
  await p.click('#numberPieces'); await wait(900);
  const e1 = await T(() => window.T.exports());
  const labs = await T(() => { const C = window.CST, L = C.layout; return L.sheets.flatMap((pl, si) => C.pieceLabels(pl, L.sh).map(lb => { const e = pl.find(x => x.key === lb.key); return { t: lb.t, name: e.it.name, si, x: e.x, y: e.y }; })); });
  const byImg = {}; for (const s of stepsNow) if (!s[2]) (byImg[s[0]] = byImg[s[0]] || []).push(s[1]);
  const gotImg = {}; for (const l of labs) (gotImg[l.name] = gotImg[l.name] || []).push(+l.t);
  ok(labs.length === N && JSON.stringify(sorted(labs.map(l => +l.t))) === JSON.stringify(seq(N)), `cut sheet: ${labs.length} pieces numbered 1..${N}, each step exactly once, no spares`);
  ok(Object.keys(byImg).every(k => JSON.stringify(sorted(gotImg[k] || [])) === JSON.stringify(sorted(byImg[k]))), 'each piece carries one of its own image\'s steps (piece #n on paper = step #n in the guide)');
  const sofaL = labs.filter(l => l.name === 'sofa.png').sort((a, b) => a.si - b.si || Math.round(a.y * 10) - Math.round(b.y * 10) || a.x - b.x).map(l => +l.t);
  ok(JSON.stringify(sofaL) === JSON.stringify(sorted(sofaL)), `copies of one image take its steps in reading order (sofas: ${sofaL.join(', ')})`);
  fs.writeFileSync(path.join(OUT, 'sample-steps-PRINT.pdf'), Buffer.from(e1.pdf, 'base64'));
  const tn = execFileSync('pdftotext', [path.join(OUT, 'sample-steps-PRINT.pdf'), '-']).toString();
  ok(JSON.stringify(sorted(nums(tn))) === JSON.stringify(seq(N)), `print PDF text = steps 1..${N}`);
  ok(e1.svgs.join('\n') === e0.svgs.join('\n') && e1.code === e0.code && e0.code === base.code, `cut SVG byte-identical with numbers on, sheet code unchanged (${e0.code})`);
  // spare: a qty above the mockup copies prints "sp"
  await T(() => { const C = window.CST; C.items.find(i => i.name === 'rug.png') && 0; const it = C.items.find(i => i.name === 'floor_lamp.png'); it.qty = 2; C.refresh(true); }); await wait(1500);
  const sp = await T(() => { const C = window.CST, L = C.layout; return L.sheets.flatMap(pl => C.pieceLabels(pl, L.sh).map(l => l.t)); });
  ok(sp.filter(t => t === 'sp').length === 1 && sp.length === N + 1, 'an extra copy not in the mockup is labelled "sp" (spare)');
  // no visible mockup piece -> image numbers again
  const fb = await T(() => { const C = window.CST; C.MK.nodes.forEach(n => n.hidden = true); C.refresh(false); const L = C.layout; return { lab: L.sheets.flatMap(pl => C.pieceLabels(pl, L.sh).map(l => l.t)), want: L.sheets.flatMap(pl => pl.map(e => String(C.numOf(e.it)))) }; });
  ok(JSON.stringify(fb.lab) === JSON.stringify(fb.want), 'all layers hidden: printed numbers fall back to image numbers');
  await p.click('#numberPieces'); await wait(300);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
