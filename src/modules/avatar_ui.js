/* Avatar builder. Its own undo stack; nothing here touches the print until Add to scene. */
(function () {
  'use strict';
  const C = window.CST;
  const $ = (s, r) => (r || document).querySelector(s);
  const stack = [], redo = [];
  let spec = { schema: 'cpa-avatar-spec/1', template: 'kid-v1', parts: {}, colors: {}, locks: {} }, editing = null;

  function db() { return new Promise((res, rej) => { const r = indexedDB.open('cst-assets', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function push() { stack.push(JSON.stringify(spec)); if (stack.length > 50) stack.shift(); redo.length = 0; }
  function setSpec(next) { spec = JSON.parse(JSON.stringify(next)); draw(); }
  async function draw() {
    const box = $('#avatarPreview'); if (!box || !C.avatar) return;
    const cat = C.assets.avatarParts(); if (!cat) { box.innerHTML = '<p>These avatar parts aren\'t available here.</p>'; return; }
    try { box.innerHTML = await C.avatar.compose(spec); } catch (e) { box.innerHTML = '<p>' + e.message + '</p>'; }
    const slots = $('#avatarSlots'); if (!slots) return;
    slots.innerHTML = (cat.slots || []).map(slot => {
      const opts = (cat.parts || []).filter(p => p.slot === slot.id);
      const cur = spec.parts[slot.id] || '';
      const locked = !!(spec.locks && spec.locks[slot.id]);
      return `<div class="avatarSlot"><b>${slot.name}</b> <button type="button" data-lock="${slot.id}" aria-pressed="${locked}" aria-label="Lock ${slot.name}">${locked ? '🔒' : '🔓'}</button>`
        + opts.map(p => `<button type="button" data-part="${p.id}" aria-pressed="${p.id === cur}" aria-label="${p.name}">${p.name}</button>`).join('')
        + `</div>`;
    }).join('');
  }
  async function thumb() {
    const svg = await C.avatar.compose(spec);
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); g.drawImage(img, 0, 0, 128, 128);
    const data = c.toDataURL('image/png'); c.width = 0; return data;
  }
  async function saveGallery() {
    const d = await db(), t = d.transaction('avatars', 'readwrite');
    const id = 'av-' + Date.now().toString(36);
    t.objectStore('avatars').put({ id, spec: JSON.parse(JSON.stringify(spec)), thumb: await thumb(), t: Date.now() });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    loadGallery();
  }
  async function loadGallery() {
    const box = $('#avatarGallery'); if (!box) return;
    try {
      const d = await db(), req = d.transaction('avatars', 'readonly').objectStore('avatars').getAll();
      const rows = await new Promise(res => { req.onsuccess = () => res(req.result || []); });
      box.innerHTML = rows.map(r => `<button type="button" data-av="${r.id}" aria-label="Saved avatar"><img alt="" src="${r.thumb}" width="64" height="64"></button>`).join('') || '<span class="muted">No saved avatars yet.</span>';
      box._rows = rows;
    } catch (e) { box.innerHTML = ''; }
  }
  function boot() {
    const root = $('#tabAvatar'); if (!root) return;
    const tab = $('#tabAvatarBtn'); if (tab) tab.hidden = false;
    root.innerHTML = '<div class="avatarWrap"><div id="avatarPreview" aria-label="Avatar preview"></div><div id="avatarSlots"></div><p>'
      + '<button type="button" id="avUndo">Undo</button> <button type="button" id="avRedo">Redo</button> '
      + '<button type="button" id="avRandom">Randomize</button> <button type="button" id="avSave">Save</button> '
      + '<button type="button" id="avAdd">Add to scene</button></p><div id="avatarGallery"></div></div>';
    $('#avatarSlots').addEventListener('click', (e) => {
      const lock = e.target.closest('[data-lock]');
      const part = e.target.closest('[data-part]');
      push();
      if (lock) { const id = lock.dataset.lock; spec.locks[id] = !spec.locks[id]; }
      if (part) {
        const id = part.dataset.part;
        const P = C.assets.avatarParts();
        const p = (P.parts || []).find(x => x.id === id);
        spec.parts[p.slot] = id;
      }
      draw();
    });
    $('#avUndo').onclick = () => { if (!stack.length) return; redo.push(JSON.stringify(spec)); setSpec(JSON.parse(stack.pop())); };
    $('#avRedo').onclick = () => { if (!redo.length) return; stack.push(JSON.stringify(spec)); setSpec(JSON.parse(redo.pop())); };
    $('#avRandom').onclick = () => { push(); spec = C.avatar.randomize((Date.now() ^ 0x85ebca6b) >>> 0, spec.locks, spec); draw(); };
    $('#avSave').onclick = () => saveGallery();
    $('#avAdd').onclick = async () => {
      if (editing) {
        const svg = await C.avatar.compose(spec);
        const dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        editing.dataURL = dataURL; editing.isSvg = true;
        editing.img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataURL; });
        editing.asset = Object.assign({}, editing.asset, { kind: 'avatar', avatar: JSON.parse(JSON.stringify(spec)) });
        for (const k of [...C.cache.keys()]) { try { if (JSON.parse(k)[0] === editing.id) C.cache.delete(k); } catch (e) { /* not a cache key */ } }
        const q = C.processed(editing, false);
        if (q.loops && q.loops.length > 1) C.toast('This avatar cuts as ' + q.loops.length + ' pieces.');
        C.mkCommit(); C.refresh(true); document.querySelector('[data-tab=tabMock]').click();
      } else await C.avatar.toItem(JSON.parse(JSON.stringify(spec)));
    };
    $('#avatarGallery').addEventListener('click', (e) => {
      const b = e.target.closest('[data-av]'); if (!b) return;
      const row = ($('#avatarGallery')._rows || []).find(r => r.id === b.dataset.av); if (!row) return;
      push(); spec = JSON.parse(JSON.stringify(row.spec)); draw();
    });
    C.bus.on('assets:ready', () => {
      const cat = C.assets.avatarParts();
      if (cat && !Object.keys(spec.parts).length && cat.presets && cat.presets[0]) spec.parts = Object.assign({}, cat.presets[0].parts);
      draw(); loadGallery();
    });
    C.bus.on('avatar:edit', (item) => { editing = item; if (item.asset && item.asset.avatar) spec = JSON.parse(JSON.stringify(item.asset.avatar)); else alert("These avatar parts aren't available here."); draw(); document.querySelector('[data-tab=tabAvatar]').click(); });
    const bar = document.querySelector('#mkColor') || document.querySelector('#mkDup');
    if (bar && !$('#mkAvatar')) {
      const b = document.createElement('button'); b.id = 'mkAvatar'; b.type = 'button'; b.title = 'Edit avatar'; b.textContent = '🙂';
      b.onclick = () => { const it = C.mkSel && C.nodeItem(C.mkSel); if (it && it.asset && it.asset.kind === 'avatar') C.bus.emit('avatar:edit', it); };
      bar.parentNode.insertBefore(b, bar.nextSibling);
    }
  }
  C.registerModule('avatar_ui', { boot, get spec() { return spec; } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
