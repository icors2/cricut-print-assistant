/* Colour sheet. Done writes the picture back onto the item and commits one undo step. */
(function () {
  'use strict';
  const C = window.CST;
  const $ = (s) => document.querySelector(s);
  let current = null, draft = {}, onlyCopy = false;

  function sheet() {
    let el = $('#colorSheet');
    if (el) return el;
    el = document.createElement('div'); el.id = 'colorSheet'; el.hidden = true;
    el.innerHTML = '<div class="sheet"><h2 id="colorTitle">Colours</h2><div id="colorRegions"></div><label><input type="checkbox" id="colorOnly"> Only this copy</label><p><button type="button" id="colorSurprise">Surprise</button> <button type="button" id="colorDone">Done</button> <button type="button" id="colorCancel">Cancel</button></p></div>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) el.hidden = true; });
    $('#colorCancel').onclick = () => { el.hidden = true; };
    $('#colorDone').onclick = () => save();
    $('#colorSurprise').onclick = () => { if (!current) return; draft = C.recolor.surprise(current.asset, (Date.now() ^ 0x9e3779b9) >>> 0); render(); };
    $('#colorOnly').onchange = (e) => { onlyCopy = e.target.checked; };
    return el;
  }
  function render() {
    const box = $('#colorRegions'); if (!box || !current) return;
    const pals = C.assets.palettes();
    box.innerHTML = (current.asset.regions || []).map(r => {
      const sw = pals.flatMap(p => p.colors || []).slice(0, 12).map(c => `<button type="button" class="swatch" data-r="${r.id}" data-c="${c}" style="background:${c}" aria-label="${r.name} ${c}"></button>`).join('');
      return `<div class="colorRow"><b>${r.name}</b> ${sw} <input type="color" data-r="${r.id}" value="${draft[r.id] || r.default}" aria-label="${r.name}"></div>`;
    }).join('');
    box.querySelectorAll('.swatch').forEach(b => b.onclick = () => { draft[b.dataset.r] = b.dataset.c; render(); });
    box.querySelectorAll('input[type=color]').forEach(inp => inp.oninput = () => { draft[inp.dataset.r] = inp.value; });
  }
  async function open(arg) {
    const asset = arg.asset || (arg.item && arg.item.asset && C.assets.get(arg.item.asset.id));
    if (!asset || !(asset.regions || []).length) return;
    current = { asset, item: arg.item || null };
    draft = Object.assign({}, (arg.item && arg.item.asset && arg.item.asset.recolor) || {});
    (asset.regions || []).forEach(r => { if (!draft[r.id]) draft[r.id] = r.default; });
    onlyCopy = false; sheet().hidden = false; const cb = $('#colorOnly'); if (cb) cb.checked = false;
    $('#colorTitle').textContent = asset.name;
    render();
  }
  async function picture(asset, recolor) {
    if (asset.files.svg) {
      let t = await C.assets.file(asset, 'svg');
      t = C.recolor.apply(t, recolor, asset.regions);
      return { dataURL: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t))), isSvg: true };
    }
    const url = await C.assets.file(asset, 'png');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const masks = {};
    for (const rid of Object.keys(asset.files.masks || {})) {
      const u = await C.assets.file(Object.assign({}, asset, { files: { png: asset.files.masks[rid] } }), 'png').catch(() => null);
      if (!u) continue;
      masks[rid] = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    }
    const canvas = C.recolor.tintPNG(img, masks, recolor, asset.regions);
    const dataURL = canvas.toDataURL('image/png'); canvas.width = 0;
    return { dataURL, isSvg: false };
  }
  async function save() {
    if (!current) return;
    const asset = current.asset, pic = await picture(asset, draft);
    let item = current.item;
    if (!item && C.mkSel) item = C.nodeItem(C.mkSel);
    if (onlyCopy && item) {
      const copy = await C.addFromDataURL(item.name, pic.dataURL, pic.dataURL, pic.isSvg, { wIn: item.wIn, hIn: item.hIn, shape: item.shape, offsetIn: item.offsetIn, asset: Object.assign({}, item.asset, { recolor: Object.assign({}, draft) }) });
      if (C.mkSel) C.mkSel.itemId = copy.id;
      item = copy;
    } else if (item) {
      item.dataURL = pic.dataURL; item.isSvg = pic.isSvg;
      item.img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = pic.dataURL; });
      item.asset = Object.assign({}, item.asset, { recolor: Object.assign({}, draft) });
      for (const k of [...C.cache.keys()]) { try { if (JSON.parse(k)[0] === item.id) C.cache.delete(k); } catch (e) { /* not a cache key */ } }
    } else {
      item = await C.assets.addAsset(asset, { recolor: Object.assign({}, draft) });
    }
    sheet().hidden = true; C.mkCommit(); C.refresh(true); C.renderMock(true);
  }
  function boot() {
    const bar = document.querySelector('#mkDup');
    if (bar && bar.parentNode && !$('#mkColor')) {
      const b = document.createElement('button'); b.id = 'mkColor'; b.type = 'button'; b.title = 'Colours'; b.textContent = '🎨';
      b.onclick = () => { const it = C.mkSel && C.nodeItem(C.mkSel); if (it && it.asset) open({ item: it, asset: C.assets.get(it.asset.id) }); };
      bar.parentNode.insertBefore(b, bar.nextSibling);
    }
    C.bus.on('color:open', open);
    C.bus.on('items:changed', () => {
      document.querySelectorAll('.card[data-id]').forEach(card => {
        if (card.querySelector('.recolorBtn')) return;
        const it = C.items.find(i => i.id === card.dataset.id);
        if (!it || !it.asset) return;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'recolorBtn'; b.textContent = '🎨'; b.title = 'Colours';
        b.onclick = () => open({ item: it, asset: C.assets.get(it.asset.id) });
        card.insertBefore(b, card.firstChild);
      });
    });
  }
  C.color = C.registerModule('color', { open, picture });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
