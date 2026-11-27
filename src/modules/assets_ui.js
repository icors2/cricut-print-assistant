/* Assets tab: categories, search, details, kid mode, private packs. */
(function () {
  'use strict';
  const C = window.CST;
  const $ = (s, r) => (r || document).querySelector(s);
  let cat = '', q = '', view = 'grid';

  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cst-assets', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('packs')) d.createObjectStore('packs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('recents')) d.createObjectStore('recents', { keyPath: 'assetId' });
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function txDone(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function idbPacks() {
    try {
      const d = await db(), t = d.transaction('packs', 'readonly'), all = t.objectStore('packs').getAll();
      const rows = await new Promise((res, rej) => { all.onsuccess = () => res(all.result || []); all.onerror = () => rej(all.error); });
      return rows;
    } catch (e) { return []; }
  }
  function mimeFor(name) {
    const ext = String(name).toLowerCase().split('.').pop();
    return { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json' }[ext] || 'application/octet-stream';
  }
  async function idbFileURL(packId, path) {
    const d = await db(), t = d.transaction('files', 'readonly'), g = t.objectStore('files').get(packId + '/' + path);
    const row = await new Promise((res, rej) => { g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
    if (!row) return null;
    if (typeof row.blob === 'string') return row.blob.startsWith('data:application/octet-stream') ? 'data:' + mimeFor(path) + row.blob.slice(29) : row.blob;
    return URL.createObjectURL(row.blob);
  }
  C.idbPacks = idbPacks; C.idbFileURL = idbFileURL;
  C.rememberAsset = async (id) => {
    try { const d = await db(), t = d.transaction('recents', 'readwrite'); t.objectStore('recents').put({ assetId: id, t: Date.now() }); await txDone(t); } catch (e) { /* ignore */ }
  };

  function direct(a) {
    if (C.assets.source !== 'fetch') return false;
    const pk = C.assets.packs.find(p => p.id === a.pack);
    return !!pk && pk.src === 'public';
  }
  async function tileThumb(a) {
    let u = a.files.thumb ? await C.assets.file(a, 'thumb') : null;
    if (!u && a.files.png) u = await C.assets.file(a, 'png');
    if (!u && a.files.svg) { const t = await C.assets.file(a, 'svg'); if (t) u = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t))); }
    return u;
  }
  function inches(n) { return (Math.round(n * 100) / 100) + ''; }
  function paint() {
    const root = $('#tabAssets'); if (!root || !C.assets) return;
    const cats = C.assets.categories();
    const side = $('#assetCats'); if (!side) return;
    const cur = cat;
    side.innerHTML = cats.map(c => `<button type="button" data-cat="${c.id}" class="${c.id === cur ? 'on' : ''}">${c.icon || ''} ${c.name}</button>`).join('')
      + '<button type="button" data-cat="__recent">⭐ Recent</button><button type="button" data-cat="__packs">📦 My packs</button>';
    let list = [];
    if (cur === '__packs') { renderPacks(); return; }
    if (cur === '__recent') list = [];
    else list = C.assets.search(q, q ? '' : (cur || undefined));
    const grid = $('#assetGrid');
    const empty = C.assets.source === 'none' ? 'No library here. Use the bundled file or the web version, or import a pack.'
      : (q && !list.length ? 'No “' + q + '” found. Try another word.' : (!list.length ? 'Nothing in this category yet.' : ''));
    grid.innerHTML = empty ? '<p class="muted">' + empty + '</p>' : list.map(a => {
      const label = a.name + ', ' + inches(a.size.w) + ' by ' + inches(a.size.h) + ' inches';
      const thumb = direct(a) ? 'assets/' + (a.files.thumb || '') : '';
      return `<button type="button" class="assetTile" role="button" data-id="${a.id}" aria-label="${label}"><img alt="" loading="lazy" src="${thumb}"><span>${a.name}</span><small>${inches(a.size.w)} × ${inches(a.size.h)} in</small></button>`;
    }).join('');
    // Only the served public catalog has files under assets/. Bundled files and imported or
    // synced private packs resolve through their pack (IndexedDB), falling back to the art itself.
    list.forEach(a => {
      if (direct(a)) return;
      const img = grid.querySelector('[data-id="' + a.id + '"] img'); if (!img) return;
      tileThumb(a).then(u => { if (u) img.src = u; }).catch(() => { /* leave blank */ });
    });
    $('#assetHead').textContent = (cats.find(c => c.id === cur) || { name: cur === '__recent' ? 'Recent' : 'All' }).name + ' · ' + list.length;
  }
  const LIB_CATS = new Set(['rooms', 'furniture', 'decor', 'items', 'characters', 'clothing']);
  const TOKEN_KEY = 'cst.assetWriteToken';
  let packNote = '';
  function token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { if (v) sessionStorage.setItem(TOKEN_KEY, v); } catch (e) { /* private mode */ } }
  function note(s) { packNote = s; const el = $('#packSaveMsg'); if (el) el.textContent = s; }
  function renderPacks() {
    const grid = $('#assetGrid');
    const packs = C.assets.packs.filter(p => p.src === 'pack');
    const rows = packs.map(p => `<div class="assetPack"><b>${p.meta.name}</b> <span class="muted">${p.meta.version} · ${p.count}${p.avatarParts ? ' · ' + p.avatarParts + ' avatar parts' : ''}</span> ${p.meta.license === 'LicenseRef-Private' ? '🔒' : ''}<button type="button" data-save="${p.id}">Save to library</button><button type="button" data-export="${p.id}">Export</button><button type="button" data-del="${p.id}">Delete</button></div>`).join('') || '<p class="muted">No private packs yet.</p>';
    grid.innerHTML = '<p><label>Write token <input id="packToken" type="password" autocomplete="off"></label> <span class="muted">The upload secret for this site. Kept for this visit only. Saving publishes every picture in the pack, under its file name, for anyone who opens the site.</span></p><p id="packSaveMsg" class="muted"></p>' + rows;
    const tok = $('#packToken'); if (tok) tok.value = token();
    const msg = $('#packSaveMsg'); if (msg) msg.textContent = packNote;
  }
  async function pngPair(url) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read the picture')); i.src = url; });
    let long = 1600, png = '', thumb = '', w = 1, h = 1, hasAlpha = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, long / Math.max(img.naturalWidth, img.naturalHeight));
      w = Math.max(1, Math.round(img.naturalWidth * scale));
      h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h).data;
      let alpha = 0;
      for (let i = 3; i < data.length; i += 16) if (data[i] < 250) alpha++;
      hasAlpha = alpha > (w * h / 4) * 0.005;
      png = c.toDataURL('image/png');
      const t = document.createElement('canvas');
      const ts = Math.min(1, 256 / Math.max(w, h));
      t.width = Math.max(1, Math.round(w * ts)); t.height = Math.max(1, Math.round(h * ts));
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      thumb = t.toDataURL('image/png');
      c.width = 0; t.width = 0;
      if (png.length + thumb.length < 1.8e6) break;
      long = Math.round(long * 0.75);
    }
    if (png.length + thumb.length >= 1.8e6) throw new Error('still over 2 MB');
    return { png, thumb, w, h, hasAlpha };
  }
  async function savePackToLibrary(packId, tok) {
    if (!/^https?:$/.test(location.protocol)) { note('This page has no library to save into. Open the web version.'); return; }
    const pics = C.assets.list().filter(a => a.pack === packId && a.files && a.files.png);
    const seen = new Set(C.assets.list().map(a => a.id));
    let saved = 0, exists = 0; const failed = [], skipped = [];
    for (let n = 0; n < pics.length; n++) {
      const asset = pics[n];
      note('Saving ' + (n + 1) + ' of ' + pics.length + '…');
      if (!LIB_CATS.has(asset.category)) { skipped.push(asset.name); continue; }
      try {
        const url = await C.assets.file(asset, 'png');
        if (!url) throw new Error('missing file');
        const pic = await pngPair(url);
        const row = C.extract.entry({ name: asset.name, category: asset.category, pxW: pic.w, pxH: pic.h, hasAlpha: pic.hasAlpha, taken: (id) => seen.has(id) });
        seen.add(row.id);
        const res = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ entry: row, png: pic.png, thumb: pic.thumb }) });
        if (res.status === 409) { exists++; continue; }
        if (!res.ok) { let err = 'Save failed (' + res.status + ')'; try { err = (await res.json()).error || err; } catch (e) { /* keep status */ } throw new Error(err); }
        saved++;
      } catch (e) { failed.push(asset.name + ' (' + e.message + ')'); }
    }
    if (saved && C.assets.reloadFetched) await C.assets.reloadFetched();
    const bits = ['Saved ' + saved + ' of ' + pics.length + '.'];
    if (exists) bits.push(exists + ' already in the library.');
    if (skipped.length) bits.push('Skipped: ' + skipped.join(', ') + '.');
    if (failed.length) bits.push('Failed: ' + failed.join(', ') + '.');
    note(bits.join(' '));
    if (cat === '__packs') renderPacks();
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function openDetails(asset) {
    const sheet = $('#assetSheet'); if (!sheet) return;
    const svg = asset.files.svg ? await C.assets.file(asset, 'svg') : '';
    const cats = [];
    const seen = new Set();
    (C.assets.categories() || []).forEach(c => { if (c.id && !seen.has(c.id)) { seen.add(c.id); cats.push(c); } });
    if (asset.category && !seen.has(asset.category)) cats.push({ id: asset.category, name: asset.category });
    const library = asset.pack === 'library' ? '<p><label>Name <input id="libName" maxlength="40" value="' + esc(asset.name) + '"></label> '
      + '<label>Category <select id="libCat">' + cats.map(c => '<option value="' + esc(c.id) + '"' + (c.id === asset.category ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label> '
      + '<label>Write token <input id="libToken" type="password" autocomplete="off"></label> '
      + '<span class="muted">The same upload secret. The name is public.</span> '
      + '<button type="button" id="libRename">Save label</button></p>' : '';
    $('#assetSheetBody').innerHTML = `<h2>${esc(asset.name)}</h2><p>Size: ${inches(asset.size.w)} × ${inches(asset.size.h)} in</p>`
      + (asset.regions && asset.regions.length ? '<p>Colors: ' + asset.regions.map(r => esc(r.name)).join(', ') + ' <button type="button" id="assetRecolor">🎨 Edit</button></p>' : '')
      + `<p class="muted">License: ${esc(asset.license)}${asset.license === 'LicenseRef-Private' ? ' 🔒' : ''} · ${esc(asset.author || '')}</p>`
      + library
      + (asset.role === 'backdrop'
        ? '<p><button type="button" id="assetBg">Use as background</button></p>'
        : '<p><button type="button" id="assetAdd">Add to scene</button> <button type="button" id="assetAdd2">Add 2</button></p>');
    sheet.hidden = false;
    const add = $('#assetAdd'); if (add) add.onclick = () => C.assets.addAsset(asset).then(() => toastAdded(asset));
    const add2 = $('#assetAdd2'); if (add2) add2.onclick = async () => { await C.assets.addAsset(asset); await C.assets.addAsset(asset); toastAdded(asset); };
    const bg = $('#assetBg'); if (bg) bg.onclick = () => useBackdrop(asset);
    const ed = $('#assetRecolor'); if (ed) ed.onclick = () => { sheet.hidden = true; C.bus.emit('color:open', { asset }); };
    const ren = $('#libRename');
    if (ren) ren.onclick = async () => {
      const name = ($('#libName').value || '').trim(), category = $('#libCat').value;
      const tok = $('#libToken');
      if (tok && tok.value && $('#extractToken')) $('#extractToken').value = tok.value;
      try {
        await C.extract_ui.rename(asset.id, name, category);
        sheet.hidden = true;
        C.toast('Saved');
      } catch (e) { alert(e.message); }
    };
    if (svg && C.recolor) { /* preview uses the file as stored */ }
  }
  let bgCat = '';
  function ensureBgPick() {
    let sheet = document.getElementById('bgPickSheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'bgPickSheet';
    sheet.hidden = true;
    sheet.innerHTML = '<div class="sheet" role="dialog" aria-labelledby="bgPickTitle"><h2 id="bgPickTitle">Choose a background</h2><div id="bgPickCats"></div><div id="bgPickGrid" class="assetGrid"></div></div>';
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) { sheet.hidden = true; return; }
      const catBtn = e.target.closest('[data-bgcat]');
      if (catBtn && sheet.contains(catBtn)) { bgCat = catBtn.dataset.bgcat; fillBgPick(); return; }
      const tile = e.target.closest('[data-bg]');
      if (!tile || !sheet.contains(tile)) return;
      const asset = C.assets.get(tile.dataset.bg);
      if (!asset) return;
      sheet.hidden = true;
      useBackdrop(asset);
    });
    document.body.appendChild(sheet);
    return sheet;
  }
  function fillBgPick() {
    const sheet = ensureBgPick();
    const cats = (C.assets.categories() || []).filter(c => c.id && c.id.charAt(0) !== '_');
    const bar = $('#bgPickCats');
    bar.innerHTML = '<button type="button" class="mini' + (bgCat ? '' : ' on') + '" data-bgcat="">All</button>'
      + cats.map(c => '<button type="button" class="mini' + (c.id === bgCat ? ' on' : '') + '" data-bgcat="' + esc(c.id) + '">' + (c.icon || '') + ' ' + esc(c.name) + '</button>').join('');
    const list = C.assets.search('', bgCat || undefined);
    const grid = $('#bgPickGrid');
    grid.innerHTML = list.length ? list.map(a => {
      const thumb = direct(a) ? 'assets/' + (a.files.thumb || '') : '';
      return '<button type="button" class="assetTile" data-bg="' + esc(a.id) + '"><img alt="" src="' + thumb + '"><span>' + esc(a.name) + '</span></button>';
    }).join('') : '<p class="muted">Nothing in this category yet.</p>';
    list.forEach(a => {
      if (direct(a)) return;
      const img = grid.querySelector('[data-bg="' + a.id + '"] img'); if (!img) return;
      tileThumb(a).then(u => { if (u) img.src = u; }).catch(() => { /* leave blank */ });
    });
    sheet.hidden = false;
  }
  async function useBackdrop(asset) {
    const isSvg = !!asset.files.svg;
    const text = isSvg ? await C.assets.file(asset, 'svg') : null;
    const url = text ? 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text))) : await C.assets.file(asset, 'png');
    C.MK.bg.img = url; C.MK.bg.imgName = asset.name; C.MK.bg.fit = 'fill';
    const fit = document.querySelector('#mkBgFit'); if (fit) fit.value = 'fill';
    C.mkCommit(); C.renderMock(true);
    document.querySelector('[data-tab=tabMock]').click();
    if (C.toast) C.toast(asset.name + ' set as the background');
  }
  function toastAdded(asset) {
    if (C.toast) C.toast(asset.name + ' added to your scene');
  }

  async function readZip(buf) {
    const u = new Uint8Array(buf), view = new DataView(buf); let o = 0; const files = {};
    while (o + 30 <= u.length) {
      if (view.getUint32(o, true) !== 0x04034b50) break;
      const method = view.getUint16(o + 8, true), comp = view.getUint32(o + 18, true), nameLen = view.getUint16(o + 26, true), extra = view.getUint16(o + 28, true);
      const name = new TextDecoder().decode(u.subarray(o + 30, o + 30 + nameLen));
      const start = o + 30 + nameLen + extra, data = u.subarray(start, start + comp);
      let bytes = data;
      if (method === 8) {
        if (typeof DecompressionStream !== 'function') throw new Error('Use the .cpapack.json form');
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else if (method !== 0) throw new Error('Use the .cpapack.json form');
      files[name] = bytes; o = start + comp;
    }
    return files;
  }
  async function importPack(file) {
    let catalog, files = {};
    if (/\.json$/i.test(file.name)) {
      const doc = JSON.parse(await file.text());
      catalog = doc.catalog || doc;
      files = doc.files || {};
    } else {
      const map = await readZip(await file.arrayBuffer());
      const pack = map['pack.json']; if (!pack) throw new Error('pack.json is missing');
      catalog = JSON.parse(new TextDecoder().decode(pack));
      for (const [name, bytes] of Object.entries(map)) {
        if (name === 'pack.json') continue;
        let bin = ''; const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        const mime = mimeFor(name);
        files[name] = 'data:' + mime + ';base64,' + btoa(bin);
      }
    }
    const errs = C.assets.validateCatalog(catalog, { publicRepo: false });
    if (errs.length) throw Object.assign(new Error(errs.map(e => e.path + ': ' + e.msg).join('\n')), { errors: errs });
    const avPath = (catalog.avatar && typeof catalog.avatar === 'object' ? catalog.avatar.parts : catalog.avatar) || 'avatar/parts.json';
    if (files[avPath]) {
      let doc = null; try { doc = JSON.parse(decodeURIComponent(escape(atob(String(files[avPath]).split(',')[1] || '')))); } catch (e) { try { doc = JSON.parse(files[avPath]); } catch (e2) { doc = null; } }
      const aerr = doc ? C.assets.validateAvatar(doc) : [{ path: avPath, msg: 'is not valid JSON' }];
      if (aerr.length) throw Object.assign(new Error(aerr.map(e => 'avatar ' + e.path + ': ' + e.msg).join('\n')), { errors: aerr });
    }
    const d = await db(), t = d.transaction(['packs', 'files'], 'readwrite');
    t.objectStore('packs').put({ id: catalog.pack.id, meta: catalog.pack, catalog, t: Date.now() });
    for (const [path, url] of Object.entries(files)) t.objectStore('files').put({ blob: url, type: '' }, catalog.pack.id + '/' + path);
    await txDone(t);
    const added = C.assets.addPack(catalog, 'pack', (path) => idbFileURL(catalog.pack.id, path));
    if (added && added.ready) await added.ready;
    C.bus.emit('assets:ready', { source: C.assets.source, count: C.assets.list().length });
  }
  async function deletePack(id) {
    const d = await db(), t = d.transaction(['packs', 'files'], 'readwrite');
    t.objectStore('packs').delete(id);
    const req = t.objectStore('files').getAllKeys();
    const keys = await new Promise(res => { req.onsuccess = () => res(req.result || []); });
    keys.filter(k => String(k).startsWith(id + '/')).forEach(k => t.objectStore('files').delete(k));
    await txDone(t);
    location.reload();
  }

  function kidMode(on) {
    C.S.ui = Object.assign({ kidMode: false, bigTargets: false, assetsView: 'grid' }, C.S.ui);
    if (on == null) on = C.S.ui.kidMode;
    C.S.ui.kidMode = !!on;
    document.documentElement.classList.toggle('kid', !!on);
    document.querySelectorAll('.tabs button[data-grown]').forEach(b => { b.hidden = !!on; });
    const g = $('#grownups'); if (g) g.hidden = !on;
    const btn = $('#kidMode'); if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) { const a = document.querySelector('[data-tab=tabAssets]'); if (a && document.querySelector('#tabLayout').style.display !== 'none') a.click(); }
  }
  function boot() {
    const root = $('#tabAssets'); if (!root) return;
    root.innerHTML = '<div class="assetSide"><input type="search" id="assetSearch" placeholder="Search" aria-label="Search stickers"><div id="assetCats"></div><button type="button" id="packImport">+ Import pack</button><input id="packFile" type="file" accept=".zip,.json,application/zip,application/json" hidden><button type="button" id="pwaOffline">Make available offline</button><button type="button" id="pwaInstall" hidden>Add to Home Screen</button></div><div class="assetMain"><div id="assetHead"></div><div id="assetGrid" class="assetGrid" role="list"></div></div><div id="assetSheet" hidden><div class="sheet" id="assetSheetBody"></div></div>';
    const search = $('#assetSearch'); let timer = 0;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value; paint(); }, 120); });
    $('#assetCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; paint(); });
    $('#assetGrid').addEventListener('click', (e) => {
      const tile = e.target.closest('.assetTile'); if (!tile) return;
      const asset = C.assets.get(tile.dataset.id); if (!asset) return;
      if (e.detail === 0) return;
      if (asset.role === 'backdrop') { useBackdrop(asset); return; }
      C.assets.addAsset(asset).then(() => toastAdded(asset));
    });
    let hold = 0;
    $('#assetGrid').addEventListener('pointerdown', (e) => {
      const tile = e.target.closest('.assetTile'); if (!tile) return;
      hold = setTimeout(() => { const asset = C.assets.get(tile.dataset.id); if (asset) openDetails(asset); }, 500);
    });
    $('#assetGrid').addEventListener('pointerup', () => clearTimeout(hold));
    $('#assetGrid').addEventListener('pointermove', () => clearTimeout(hold));
    $('#assetSheet').addEventListener('click', (e) => { if (e.target.id === 'assetSheet') e.currentTarget.hidden = true; });
    $('#packImport').onclick = () => $('#packFile').click();
    $('#packFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await importPack(f); cat = '__packs'; paint(); C.toast('Pack imported'); } catch (err) { alert(err.message); } };
    $('#assetGrid').addEventListener('click', async (e) => {
      const del = e.target.dataset && e.target.dataset.del, exp = e.target.dataset && e.target.dataset.export;
      const saveId = e.target.dataset && e.target.dataset.save;
      if (saveId) {
        const input = $('#packToken');
        const tok = (input && input.value.trim()) || token();
        if (!tok) { note('Type the write token to save.'); return; }
        setToken(tok);
        const ex = $('#extractToken'); if (ex) ex.value = tok;
        e.target.disabled = true;
        try { await savePackToLibrary(saveId, tok); } catch (err) { note(err.message); }
        return;
      }
      if (del && confirm('Delete this pack? You can undo for 10 seconds by importing it again from a copy.')) deletePack(del);
      if (exp) {
        const rows = await idbPacks(), row = rows.find(r => r.id === exp); if (!row) return;
        const keys = await new Promise((res, rej) => { const d = db(); d.then(db => { const req = db.transaction('files').objectStore('files').getAllKeys(); req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error); }); });
        const files = {};
        for (const k of keys.filter(k => String(k).startsWith(exp + '/'))) {
          const url = await idbFileURL(exp, String(k).slice(exp.length + 1));
          if (url) files[String(k).slice(exp.length + 1)] = url;
        }
        C.saveBlob(exp + '.cpapack.json', JSON.stringify({ catalog: row.catalog, files }), 'application/json');
      }
    });
    const off = $('#pwaOffline'); if (off && C.pwa) off.onclick = async () => { const r = await C.pwa.makeOffline(); C.toast(r.ok ? 'Available offline' : 'Could not cache the library'); };
    const bgPick = $('#mkBgAsset'); if (bgPick) bgPick.onclick = () => fillBgPick();
    if (C.pwa && C.pwa.bindInstall) C.pwa.bindInstall($('#pwaInstall'));
    const kid = $('#kidMode');
    if (kid) kid.onclick = () => { kidMode(!C.S.ui.kidMode); try { localStorage.setItem('cst.settings', JSON.stringify(C.S)); } catch (e) { /* ignore */ } };
    const grown = $('#grownups'); let gTimer = 0;
    if (grown) {
      const down = () => { gTimer = setTimeout(() => { kidMode(false); }, 2000); };
      grown.addEventListener('pointerdown', down);
      grown.addEventListener('pointerup', () => clearTimeout(gTimer));
      grown.addEventListener('pointerleave', () => clearTimeout(gTimer));
    }
    C.S.ui = Object.assign({}, C.S.ui);
    if (C.S.ui.kidMode == null && window.matchMedia('(pointer: coarse)').matches) C.S.ui.kidMode = true;
    kidMode(!!C.S.ui.kidMode);
    C.bus.on('assets:ready', () => { if (!cat) { const cats = C.assets.categories(); cat = cats.length ? cats[0].id : ''; } paint(); });
    C.bus.on('tab:shown', (id) => { if (id === 'tabAssets') paint(); });
    if (C.assets && C.assets.list().length) paint();
  }
  C.assets_ui = C.registerModule('assets_ui', { boot, kidMode, importPack, paint, savePackToLibrary });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
