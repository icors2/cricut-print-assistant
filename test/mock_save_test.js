// Mockup tab: collapsible panels (summary line, state survives a reload), Save mockup (file with every image embedded) -> fresh page -> Open mockup
// restores an identical mockup, guide and Layout exports; named browser saves in IndexedDB (save, Ctrl+S, rename, delete, open) and the
// image autosave restore a reload; low-storage warning; the mockup file also opens with the Layout tab's Open project.
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..'), OUT = path.join(R, 'sample_output'), SC = path.join(__dirname, 'samples', 'scene'), BG = path.join(__dirname, 'samples', 'bg');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = ['wall_panel.png', 'floor_boards.png', 'window.png', 'sofa.png', 'floor_lamp.png', 'rug.png', 'bear_headset.png'];
const HELP = () => { const C = window.CST; window.T = {
  b64: (doc) => { const u = new Uint8Array(doc.output('arraybuffer')); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  frozen: (f) => { const RD = Date; class FD extends RD { constructor(...a) { super(...(a.length ? a : [1764061200000])); } static now() { return 1764061200000; } } window.Date = FD; try { return f(); } finally { window.Date = RD; } },
  name: (n) => { const it = C.items.find(i => i.id === n.itemId); return it ? it.name : n.name; },
  nodes: (nm) => C.MK.nodes.filter(n => window.T.name(n) === nm),
  state: () => JSON.stringify({ nodes: C.MK.nodes.map(n => [window.T.name(n), +n.x.toFixed(6), +n.y.toFixed(6), n.rot, !!n.flip, !!n.hidden, !!n.noNum]), bg: Object.assign({}, C.MK.bg, { img: (C.MK.bg.img || '').length }), guide: C.MK.guide, ghost: C.MK.ghost, num: C.MK.num,
    items: C.items.map(i => [i.name, +i.wIn.toFixed(6), +i.hIn.toFixed(6), i.qty, i.shape, i.offsetIn, i.border, i.rotate, i.dataURL.length]) }),
  all: () => { C.computeLayout(); return window.T.frozen(() => { const d = C.buildPDF(); d.setFileId('00000000000000000000000000000000'); const g = C.guidePDF(); g.setFileId('00000000000000000000000000000000');
    return { mock: C.mockPNG(), guide: C.guidePNG(), guidePDF: window.T.b64(g), pdf: window.T.b64(d), svgs: C.buildSVGs().join('\n'), code: C.stateCode(C.currentState()) }; }); },
  grab: () => { const o = URL.createObjectURL; window.T.blobs = []; URL.createObjectURL = (b) => { window.T.blobs.push(b); return o.call(URL, b); }; } }; };
(async () => {
  if (!fs.existsSync(path.join(SC, 'bear_headset.png'))) execFileSync('python3', [path.join(__dirname, 'make_scene.py')]);
  fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
  const errs = []; let promptAnswer = null; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => { if (d.type() === 'prompt') d.accept(promptAnswer || undefined); else if (d.type() === 'confirm') d.accept(); else { errs.push('dialog: ' + d.message()); d.accept(); } });
  const T = (f, ...a) => p.evaluate(f, ...a);
  const wipe = async () => { await T(async () => { localStorage.clear(); sessionStorage.clear(); window.name = ''; await new Promise(r => { const q = indexedDB.deleteDatabase('cst-mockups'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); }); };
  const URLF = 'file://' + R + '/index.html';
  await p.goto(URLF); await wipe(); await p.reload(); await wait(500);
  await (await p.$('#file')).uploadFile(...FILES.map(f => path.join(SC, f))); await p.waitForFunction((n) => window.CST.items.length === n, { timeout: 20000 }, FILES.length);
  await T(() => { const C = window.CST; C.items.forEach(i => C.setPct(i, 100)); const r = C.items.find(i => i.name === 'rug.png'); r.offsetIn = 0.06; r.border = 'white'; C.refresh(true); }); await wait(2500); await p.evaluate(HELP);
  await p.click('[data-tab=tabMock]'); await wait(800);
  await (await p.$('#mkBgFile')).uploadFile(path.join(BG, 'wallpaper_tile_150dpi.png')); await wait(800);
  await T(() => { const C = window.CST, T = window.T, click = (s) => document.querySelector(s).click(), set = (q, v) => { const e = document.querySelector(q); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
    set('#mkBgFit', 'tile'); set('#mkBgScaleN', '60');
    C.mkSelect(T.nodes('sofa.png')[0]); click('#mkDup'); C.mkSelect(T.nodes('bear_headset.png')[0]); click('#mkFlip'); click('#mkRotR');
    T.nodes('window.png')[0].hidden = true; T.nodes('floor_lamp.png')[0].noNum = true; C.mkOrder(T.nodes('rug.png')[0], 'front');
    C.mkSetSize(C.items.find(i => i.name === 'floor_lamp.png'), 1.1, 2.4);
    set('#mkGuide', 'ghost'); set('#mkNumSize', '120'); C.mkSelect(null); }); await wait(2500);

  // 1) collapsible panels
  const panels = await T(() => [...document.querySelectorAll('#tabMock .panel[data-col]')].map(P => P.dataset.col));
  ok(['back', 'layers', 'images', 'guide', 'save'].every(k => panels.includes(k)), 'Mockup panels with a collapse chevron: ' + panels.join(', '));
  await p.click('.panel[data-col=back] h2'); await p.click('.panel[data-col=guide] h2'); await wait(300);
  const col = await T(() => ['back', 'guide', 'layers'].map(k => { const P = document.querySelector(`.panel[data-col=${k}]`); return { k, c: P.classList.contains('collapsed'), sum: P.querySelector('.psum').textContent, hiddenBody: [...P.children].filter(e => e.tagName !== 'H2').every(e => getComputedStyle(e).display === 'none') }; }));
  ok(col[0].c && col[0].hiddenBody && col[0].sum === 'Letter portrait · bg: wallpaper_tile_150dpi.png Tile', `Backdrop panel collapses to one line: "${col[0].sum}"`);
  ok(col[1].c && col[1].hiddenBody && col[1].sum === 'Guide: ghost · numbers all (1 hidden) · size 120%', `Assembly guide panel collapses: "${col[1].sum}"`);
  ok(!col[2].c && /front at the top/.test(col[2].sum), 'Layers panel still open, shows its hint');
  await wait(2200);
  const ref = await T(() => window.T.all()), st0 = await T(() => window.T.state());

  // 2) Save mockup (file)
  await T(() => window.T.grab()); await p.click('#mkSaveFile'); await wait(500);
  const saved = await T(async () => { const bl = window.T.blobs[0]; return { name: document.querySelectorAll('a[download]').length, txt: await bl.text() }; });
  const J = JSON.parse(saved.txt), fn = path.join(os.tmpdir(), 'cst-mockup-save.json'); fs.writeFileSync(fn, saved.txt); fs.copyFileSync(fn, path.join(OUT, 'mockup-save.json'));
  ok(J.app === 'cricut-full-sheet-tool' && J.kind === 'mockup' && J.items.length === 7 && J.items.every(i => /^data:image\//.test(i.dataURL)) && /^data:image\/png/.test(J.mockup.bg.img), `mockup file embeds all 7 images + the background image (${(saved.txt.length / 1e6).toFixed(2)} MB)`);
  ok(J.mockup.nodes.length === 8 && J.mockup.nodes.some(n => n.noNum) && J.mockup.nodes.some(n => n.hidden) && J.mockup.nodes.some(n => n.flip) && J.mockup.guide === 'ghost' && J.mockup.num.size === 120 && J.items.find(i => i.name === 'rug.png').offsetIn === 0.06, 'file has layers, transforms, order, visibility, hidden numbers, guide options, cut settings');

  // 3) fresh page -> Open mockup
  await wipe(); await p.reload(); await wait(800); await p.evaluate(HELP);
  ok(await T(() => window.CST.items.length === 0), 'fresh page: no images');
  await p.click('[data-tab=tabMock]'); await wait(300);
  await (await p.$('#mkOpenInput')).uploadFile(fn); await p.waitForFunction(() => window.CST.items.length === 7, { timeout: 20000 }); await wait(3000);
  const st1 = await T(() => window.T.state()), r1 = await T(() => window.T.all());
  ok(st1 === st0, 'Open mockup: identical state (images, sizes, cut settings, layers, transforms, order, visibility, numbers, guide, backdrop)');
  ok(r1.mock === ref.mock && r1.guide === ref.guide && r1.guidePDF === ref.guidePDF, 'identical Mockup PNG, Guide PNG and Guide PDF');
  ok(r1.pdf === ref.pdf && r1.svgs === ref.svgs && r1.code === ref.code, `identical Layout print PDF + cut SVG, sheet code ${r1.code}`);
  const v1 = await T(() => { const c = document.querySelector('#mkCanvas'); return c.toDataURL(); });
  ok(await T(() => document.querySelector('.panel[data-col=back]').classList.contains('collapsed') === false), 'collapse state is a browser setting (fresh page: panels open)');

  // 4) collapse state survives a reload
  await p.click('.panel[data-col=back] h2'); await p.click('.panel[data-col=layers] h2'); await wait(2200);
  await p.reload(); await p.waitForFunction(() => window.CST && window.CST.items.length === 7, { timeout: 20000 }); await wait(2500); await p.evaluate(HELP); await p.click('[data-tab=tabMock]'); await wait(800);
  const col2 = await T(() => ['back', 'layers', 'guide'].map(k => document.querySelector(`.panel[data-col=${k}]`).classList.contains('collapsed')));
  ok(col2[0] && col2[1] && !col2[2], 'collapsed panels stay collapsed after a reload');
  ok(await T(() => document.querySelector('.panel[data-col=layers] .psum').textContent === '8 layers · 1 hidden'), 'Layers summary: "8 layers · 1 hidden"');
  // ... and the reload itself restored everything from the image autosave (no re-upload)
  const st2 = await T(() => window.T.state()), r2 = await T(() => window.T.all());
  ok(st2 === st0 && r2.mock === ref.mock && r2.guidePDF === ref.guidePDF && r2.pdf === ref.pdf && r2.svgs === ref.svgs, 'autosave in IndexedDB: a reload brings back the images and an identical mockup + exports');
  await p.click('.panel[data-col=layers] h2'); await p.click('.panel[data-col=back] h2'); await wait(300);

  // 5) named browser saves
  await T(() => { document.querySelector('#mkSaveName').value = 'Room A'; document.querySelector('#mkSaveIdb').click(); }); await p.waitForFunction(() => document.querySelectorAll('#mkSaves .srow').length === 1, { timeout: 10000 });
  const stA = await T(() => window.T.state());
  await T(() => { const C = window.CST, n = window.T.nodes('sofa.png')[1]; n.x += 0.5; n.y -= 0.25; C.renderMock(true); document.querySelector('#mkSaveName').value = 'Room B'; document.querySelector('#mkCanvas').focus(); });
  await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control');
  await p.waitForFunction(() => document.querySelectorAll('#mkSaves .srow').length === 2, { timeout: 10000 });
  const rows = await T(() => [...document.querySelectorAll('#mkSaves .srow')].map(r => [r.querySelector('b').textContent, !!r.querySelector('img'), r.querySelector('.muted').textContent]));
  ok(rows.map(r => r[0]).join() === 'Room B,Room A' && rows.every(r => r[1] && /7 images/.test(r[2])), `Save in browser + Ctrl+S: 2 named saves with thumbnails (${rows.map(r => r[0] + ' · ' + r[2]).join(' | ')})`);
  // same name overwrites
  await T(() => { const n = window.T.nodes('sofa.png')[1]; n.x += 0.1; window.CST.renderMock(true); }); await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await wait(1200);
  ok(await T(() => document.querySelectorAll('#mkSaves .srow').length === 2), 'Ctrl+S again under the same name overwrites it (still 2 saves)');
  const stB = await T(() => window.T.state());
  promptAnswer = 'Room C'; await p.click('#mkSaves .srow:first-child [data-a=ren]'); await wait(800);
  ok(await T(() => [...document.querySelectorAll('#mkSaves .srow b')].map(b => b.textContent).join() === 'Room C,Room A'), 'rename: Room B → Room C');
  await p.click('#mkSaves .srow:last-child [data-a=open]'); await wait(3500); await p.evaluate(HELP);
  ok(await T(() => window.T.state()) === stA, 'open "Room A" restores exactly what was saved there');
  await p.screenshot({ path: path.join(OUT, 'ui_mockup_save.png') });
  // reload: saves still listed, open Room C
  await p.reload(); await p.waitForFunction(() => window.CST && window.CST.items.length === 7, { timeout: 20000 }); await wait(2000); await p.evaluate(HELP); await p.click('[data-tab=tabMock]'); await wait(800);
  ok(await T(() => window.T.state()) === stA, 'after a reload the autosave holds the last opened state (Room A)');
  ok(await T(() => [...document.querySelectorAll('#mkSaves .srow b')].map(b => b.textContent).join() === 'Room C,Room A'), 'named saves survive a reload');
  await p.click('#mkSaves .srow:first-child [data-a=open]'); await wait(3500); await p.evaluate(HELP);
  ok(await T(() => window.T.state()) === stB, 'open "Room C" (after the reload) restores its images and layers');
  await p.click('#mkSaves .srow:last-child [data-a=del]'); await wait(800);
  ok(await T(() => [...document.querySelectorAll('#mkSaves .srow b')].map(b => b.textContent).join() === 'Room C'), 'delete (after confirm): Room A gone');
  // storage info + low-storage warning
  ok(await T(() => /Browser storage: .* used of /.test(document.querySelector('#mkStore').textContent)), 'storage usage shown: ' + await T(() => document.querySelector('#mkStore').textContent));
  const low = await T(async () => { const C = window.CST, o = navigator.storage.estimate; navigator.storage.estimate = async () => ({ usage: 1.95e9, quota: 2e9 }); try { const r = await C.mkStorageInfo(); return { low: r.low, txt: document.querySelector('#mkStore').textContent, warn: document.querySelector('#mkStore').classList.contains('warn') }; } finally { navigator.storage.estimate = o; } });
  ok(low.low && low.warn && /almost full/.test(low.txt), `low storage warning: "${low.txt}"`);
  await T(() => window.CST.mkStorageInfo());
  // the mockup file also opens with the Layout tab's Open project (one file restores everything)
  await wipe(); await p.reload(); await wait(800); await p.evaluate(HELP);
  await (await p.$('#projFile')).uploadFile(fn); await p.waitForFunction(() => window.CST.items.length === 7, { timeout: 20000 }); await wait(3000);
  const r3 = await T(() => window.T.all());
  ok(await T(() => window.T.state()) === st0 && r3.pdf === ref.pdf && r3.mock === ref.mock, 'Open project (Layout tab) reads the mockup file too: identical');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
