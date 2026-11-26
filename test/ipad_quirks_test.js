// P1·M4: share sheet, canvas budget, storage banner, HEIC message.
const puppeteer = require('puppeteer-core'), fs = require('fs'), os = require('os'), path = require('path');
const { KnownDevices } = puppeteer;
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const R = path.resolve(__dirname, '..');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="1in" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7fb3d5"/></svg>';
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome'), headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto('file://' + path.join(R, 'index.html')); await wait(300);
  const share = await p.evaluate(async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    let downloaded = null;
    const orig = window.CST.download;
    window.CST.download = (name) => { downloaded = name; };
    navigator.canShare = (o) => !!(o && o.files);
    let shared = null;
    navigator.share = async (o) => { shared = { name: o.files[0].name, type: o.files[0].type }; };
    const a = await window.CST.pwa.shareOrDownload('sheet-PRINT.pdf', blob);
    navigator.canShare = () => false;
    const b = await window.CST.pwa.shareOrDownload('sheet-PRINT.pdf', blob);
    window.CST.download = orig;
    return { a, shared, b, downloaded };
  });
  ok(share.a === 'shared' && share.shared.name === 'sheet-PRINT.pdf' && share.shared.type === 'application/pdf', 'shareOrDownload shares a File when canShare is true');
  ok(share.b === 'downloaded' && share.downloaded === 'sheet-PRINT.pdf', 'shareOrDownload calls download() otherwise');

  await p.evaluateOnNewDocument(() => { /* persisted stub applied after load below */ });
  await p.emulate(KnownDevices['iPad Pro 11']);
  await p.goto('file://' + path.join(R, 'index.html')); await wait(400);
  const budget = await p.evaluate(async (svg) => {
    const url = 'data:image/svg+xml;base64,' + btoa(svg);
    await window.CST.addFromDataURL('huge', url, url, true, { wIn: 30, hIn: 20, shape: 'rect', offsetIn: 0 });
    window.CST.S.ui = { bigTargets: true }; window.CST.applyChrome();
    window.CST.cache.clear();
    const it = window.CST.items[0];
    const proc = window.CST.processed(it);
    const c = proc.print.canvas;
    return { px: c.width * c.height, note: document.querySelector('#dpiNote').textContent, hidden: document.querySelector('#dpiNote').hidden, dpi: window.CST.budgetDpi(it) };
  }, SVG);
  ok(budget.px <= 16777216, 'processed canvas stays within 16.7M px (' + budget.px + ')');
  ok(!budget.hidden && /dpi/.test(budget.note) && /iPad memory/.test(budget.note), 'dpi note: ' + budget.note);

  const banner = await p.evaluate(async () => {
    navigator.storage.persisted = async () => false;
    document.documentElement.classList.add('big');
    sessionStorage.removeItem('cst.storageNudge');
    await window.CST.storageNudge();
    const el = document.querySelector('#storageNudge');
    const shown = el && !el.hidden;
    document.querySelector('#storageNudgeHide').click();
    return { shown, after: el.hidden };
  });
  ok(banner.shown && banner.after, 'storage banner appears when persistence is off and can be dismissed');

  const heic = path.join(os.tmpdir(), 'photo.heic');
  fs.writeFileSync(heic, 'not-a-photo');
  await (await p.$('#file')).uploadFile(heic);
  await wait(400);
  ok(dialogs.some(m => /PNG or JPG/.test(m) && /Most Compatible/.test(m)), 'HEIC gets the friendly message: ' + dialogs.join(' | '));
  await b.close();
  try { fs.unlinkSync(heic); } catch (e) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
