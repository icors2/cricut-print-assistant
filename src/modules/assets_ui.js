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
  async function idbFileURL(packId, path) {
    const d = await db(), t = d.transaction('files', 'readonly'), g = t.objectStore('files').get(packId + '/' + path);
    const row = await new Promise((res, rej) => { g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
    if (!row) return null;
    if (typeof row.blob === 'string') return row.blob;
    return URL.createObjectURL(row.blob);
  }
  C.idbPacks = idbPacks; C.idbFileURL = idbFileURL;
  C.rememberAsset = async (id) => {
    try { const d = await db(), t = d.transaction('recents', 'readwrite'); t.objectStore('recents').put({ assetId: id, t: Date.now() }); await txDone(t); } catch (e) { /* ignore */ }
  };

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
      const thumb = 'assets/' + (a.files.thumb || '');
      return `<button type="button" class="assetTile" role="button" data-id="${a.id}" aria-label="${label}"><img alt="" loading="lazy" src="${C.assets.source === 'bundled' ? '' : thumb}"><span>${a.name}</span><small>${inches(a.size.w)} × ${inches(a.size.h)} in</small></button>`;
    }).join('');
    if (C.assets.source === 'bundled') list.forEach(a => { const img = grid.querySelector('[data-id="' + a.id + '"] img'); if (img) C.assets.file(a, 'thumb').then(u => { if (u) img.src = u; }); });
    $('#assetHead').textContent = (cats.find(c => c.id === cur) || { name: cur === '__recent' ? 'Recent' : 'All' }).name + ' · ' + list.length;
  }
  function renderPacks() {
    const grid = $('#assetGrid');
    const packs = C.assets.packs.filter(p => p.src === 'pack');
    grid.innerHTML = packs.map(p => `<div class="assetPack"><b>${p.meta.name}</b> <span class="muted">${p.meta.version} · ${p.count}${p.avatarParts ? ' · ' + p.avatarParts + ' avatar parts' : ''}</span> ${p.meta.license === 'LicenseRef-Private' ? '🔒' : ''}<button type="button" data-export="${p.id}">Export</button><button type="button" data-del="${p.id}">Delete</button></div>`).join('') || '<p class="muted">No private packs yet.</p>';
  }
  async function openDetails(asset) {
    const sheet = $('#assetSheet'); if (!sheet) return;
    const svg = asset.files.svg ? await C.assets.file(asset, 'svg') : '';
    $('#assetSheetBody').innerHTML = `<h2>${asset.name}</h2><p>Size: ${inches(asset.size.w)} × ${inches(asset.size.h)} in</p>`
      + (asset.regions && asset.regions.length ? '<p>Colors: ' + asset.regions.map(r => r.name).join(', ') + ' <button type="button" id="assetRecolor">🎨 Edit</button></p>' : '')
      + `<p class="muted">License: ${asset.license}${asset.license === 'LicenseRef-Private' ? ' 🔒' : ''} · ${asset.author || ''}</p>`
      + '<p><button type="button" id="assetAdd">Add to scene</button> <button type="button" id="assetAdd2">Add 2</button>'
      + (asset.role === 'backdrop' ? ' <button type="button" id="assetBg">Use as background</button>' : '') + '</p>';
    sheet.hidden = false;
    $('#assetAdd').onclick = () => C.assets.addAsset(asset).then(() => toastAdded(asset));
    $('#assetAdd2').onclick = async () => { await C.assets.addAsset(asset); await C.assets.addAsset(asset); toastAdded(asset); };
    const bg = $('#assetBg'); if (bg) bg.onclick = () => useBackdrop(asset);
    const ed = $('#assetRecolor'); if (ed) ed.onclick = () => { sheet.hidden = true; C.bus.emit('color:open', { asset }); };
    if (svg && C.recolor) { /* preview uses the file as stored */ }
  }
  async function useBackdrop(asset) {
    const isSvg = !!asset.files.svg;
    const text = isSvg ? await C.assets.file(asset, 'svg') : null;
    const url = text ? 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text))) : await C.assets.file(asset, 'png');
    C.MK.bg.img = url; C.MK.bg.imgName = asset.name; C.MK.bg.fit = 'fill';
    const fit = document.querySelector('#mkBgFit'); if (fit) fit.value = 'fill';
    C.mkCommit(); C.renderMock(true);
    document.querySelector('[data-tab=tabMock]').click();
  }
  function toastAdded(asset) {
    const t = $('#toast'); if (!t || !C.toast) { C.toast && C.toast(asset.name + ' added'); return; }
    t.className = 'toast show'; t.innerHTML = '';
    t.append(asset.name + ' added to your scene. ');
    const go = document.createElement('button'); go.type = 'button'; go.textContent = 'Go to Mockup'; go.onclick = () => document.querySelector('[data-tab=tabMock]').click();
    const un = document.createElement('button'); un.type = 'button'; un.textContent = 'Undo'; un.onclick = () => C.mkUndo();
    t.append(go, un);
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
        const mime = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
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
    root.innerHTML = '<div class="assetSide"><input type="search" id="assetSearch" placeholder="Search" aria-label="Search stickers"><div id="assetCats"></div><button type="button" id="packImport">+ Import pack</button><input id="packFile" type="file" accept=".zip,.json,application/zip,application/json" hidden><button type="button" id="pwaOffline">Make available offline</button></div><div class="assetMain"><div id="assetHead"></div><div id="assetGrid" role="list"></div></div><div id="assetSheet" hidden><div class="sheet" id="assetSheetBody"></div></div>';
    const search = $('#assetSearch'); let timer = 0;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value; paint(); }, 120); });
    $('#assetCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; paint(); });
    $('#assetGrid').addEventListener('click', (e) => {
      const tile = e.target.closest('.assetTile'); if (!tile) return;
      const asset = C.assets.get(tile.dataset.id); if (!asset) return;
      if (e.detail === 0) return;
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
  C.assets_ui = C.registerModule('assets_ui', { boot, kidMode, importPack, paint });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
