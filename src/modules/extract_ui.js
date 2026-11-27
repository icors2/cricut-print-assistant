/* Extract one sticker from a picture and save it to the shared library. */
(function () {
  'use strict';
  const C = window.CST;
  const $ = (s, r) => (r || document).querySelector(s);
  const TOKEN_KEY = 'cst.assetWriteToken';
  const CATS = [
    { id: 'rooms', name: 'Rooms' },
    { id: 'furniture', name: 'Furniture' },
    { id: 'decor', name: 'Decor' },
    { id: 'items', name: 'Items' }
  ];
  let work = null, box = null, drag = null, result = null;

  function token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { if (v) sessionStorage.setItem(TOKEN_KEY, v); } catch (e) { /* private mode */ } }
  function categories() {
    const seen = new Set(), out = [];
    (C.assets ? C.assets.categories() : []).forEach(c => { if (c.id && !seen.has(c.id) && c.id.charAt(0) !== '_') { seen.add(c.id); out.push(c); } });
    return out.length ? out : CATS;
  }
  function say(msg) { const el = $('#extractMsg'); if (el) el.textContent = msg || ''; }
  function canvasPoint(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / Math.max(1, r.width), y: (e.clientY - r.top) * canvas.height / Math.max(1, r.height) };
  }
  function paintBox() {
    const canvas = $('#extractCanvas'); if (!canvas || !work) return;
    const g = canvas.getContext('2d');
    g.drawImage(work, 0, 0);
    if (!box) return;
    g.strokeStyle = '#1f6feb'; g.lineWidth = Math.max(2, canvas.width / 200);
    g.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  }
  function refreshPreview() {
    const preview = $('#extractPreview');
    if (!work || !box || box.w < 4 || box.h < 4) { result = null; if (preview) preview.width = 0; return; }
    const src = work.getContext('2d').getImageData(0, 0, work.width, work.height);
    const knock = $('#extractKnock') && $('#extractKnock').checked;
    result = C.extract.prepare(src.data, work.width, work.height, box, knock);
    if (knock && !result.flat) say('The background was not a flat color. The box is kept as it is.');
    else if (!say.busy) say('');
    const c = preview;
    c.width = result.w; c.height = result.h;
    c.getContext('2d').putImageData(new ImageData(result.data, result.w, result.h), 0, 0);
  }
  function pngURL(canvas) { return canvas.toDataURL('image/png'); }
  function thumbURL(src) {
    const long = Math.max(src.width, src.height), s = Math.min(1, 256 / long);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const url = pngURL(c); c.width = 0; return url;
  }
  async function readResponse(res) {
    if (res.status === 401) throw new Error('That write token was not accepted.');
    if (res.status === 404) throw new Error('This page has no library to save into. Open the web version.');
    if (!res.ok) throw new Error((await res.text()) || ('Could not save (' + res.status + ').'));
  }
  async function postJSON(url, method, body) {
    const tok = ($('#extractToken') && $('#extractToken').value.trim()) || token();
    if (!tok) throw new Error('Type the write token to save.');
    setToken(tok);
    let res;
    try {
      res = await fetch(url, { method: method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('This page has no library to save into. Open the web version.');
    }
    await readResponse(res);
    if (C.assets && C.assets.reloadFetched) await C.assets.reloadFetched();
  }
  async function save() {
    const name = ($('#extractName').value || '').trim();
    if (!result) { say('Drag a box around one thing first.'); return; }
    if (!name || name.length > 40) { say('Give it a name, up to 40 characters.'); return; }
    const category = $('#extractCat').value;
    const taken = (id) => !!(C.assets && C.assets.get(id));
    const row = C.extract.entry({ name: name, category: category, pxW: result.w, pxH: result.h, hasAlpha: result.hasAlpha, taken: taken });
    const c = document.createElement('canvas');
    c.width = result.w; c.height = result.h;
    c.getContext('2d').putImageData(new ImageData(result.data, result.w, result.h), 0, 0);
    const png = pngURL(c), thumb = thumbURL(c);
    c.width = 0;
    say('Saving…'); say.busy = true;
    try {
      await postJSON('/api/assets', 'POST', { entry: row, png: png, thumb: thumb });
      say(row.name + ' is in the library.');
      say.busy = false;
    } catch (e) { say.busy = false; say(e.message); }
  }
  async function rename(id, name, category) {
    await postJSON('/api/assets/' + id, 'PATCH', { name: name, category: category });
  }
  function fillCats(selected) {
    const sel = $('#extractCat'); if (!sel) return;
    const cats = categories();
    sel.innerHTML = cats.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
    if (selected && cats.some(c => c.id === selected)) sel.value = selected;
  }
  function openSheet() {
    const sheet = $('#extractSheet'); if (!sheet) return;
    sheet.hidden = false;
    fillCats();
    const tok = $('#extractToken'); if (tok && !tok.value) tok.value = token();
  }
  function useCanvas(canvas) {
    work = canvas;
    const view = $('#extractCanvas');
    view.width = canvas.width; view.height = canvas.height;
    box = null; result = null; paintBox();
    const preview = $('#extractPreview'); if (preview) preview.width = 0;
    openSheet();
  }
  function loadImage(img) {
    const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    useCanvas(c);
  }
  function loadFile(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); loadImage(img); res(); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Use a PNG or JPG.')); };
      img.src = url;
    });
  }
  function loadPixels(data, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    useCanvas(c);
  }
  function setBox(next) {
    box = { x: next.x, y: next.y, w: next.w, h: next.h };
    paintBox(); refreshPreview();
  }
  function boot() {
    const side = document.querySelector('.assetSide'); if (!side || $('#extractOpen')) return;
    const btn = document.createElement('button');
    btn.id = 'extractOpen'; btn.type = 'button'; btn.textContent = 'Extract from a picture';
    const imp = $('#packImport'); side.insertBefore(btn, imp || null);
    btn.onclick = () => openSheet();
    const sheet = document.createElement('div');
    sheet.id = 'extractSheet'; sheet.hidden = true;
    sheet.innerHTML = '<div class="sheet"><h2>Extract a sticker</h2>'
      + '<p><button type="button" id="extractPick">Choose a picture</button> <input id="extractFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></p>'
      + '<p class="muted">Drag a box around one thing.</p>'
      + '<canvas id="extractCanvas" aria-label="Picture"></canvas>'
      + '<p><canvas id="extractPreview" aria-label="Sticker preview"></canvas></p>'
      + '<label class="chk"><input type="checkbox" id="extractKnock" checked> Remove plain background</label>'
      + '<label>Name <input id="extractName" maxlength="40" autocomplete="off"></label>'
      + '<label>Category <select id="extractCat"></select></label>'
      + '<label>Write token <input id="extractToken" type="password" autocomplete="off"></label>'
      + '<p><button type="button" class="btn" id="extractSave">Save to library</button></p>'
      + '<p id="extractMsg" role="status"></p></div>';
    document.body.appendChild(sheet);
    fillCats();
    $('#extractPick').onclick = () => $('#extractFile').click();
    $('#extractFile').onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { await loadFile(f); say(''); } catch (err) { say(err.message); }
    };
    const canvas = $('#extractCanvas');
    canvas.addEventListener('pointerdown', (e) => {
      if (!work) return;
      canvas.setPointerCapture(e.pointerId);
      drag = canvasPoint(e, canvas);
      box = { x: drag.x, y: drag.y, w: 0, h: 0 };
      paintBox();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = canvasPoint(e, canvas);
      box = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
      paintBox();
    });
    const end = () => { if (!drag) return; drag = null; refreshPreview(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    $('#extractKnock').onchange = () => refreshPreview();
    $('#extractSave').onclick = () => save();
    sheet.addEventListener('click', (e) => { if (e.target.id === 'extractSheet') sheet.hidden = true; });
  }
  C.extract_ui = C.registerModule('extract_ui', { boot, openSheet, loadFile, loadPixels, setBox, rename, save, get result() { return result; } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
