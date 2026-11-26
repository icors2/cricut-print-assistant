/* Service worker registration and the iPad share / offline helpers. */
(function () {
  'use strict';
  const C = window.CST;
  const served = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  let tried = false;
  async function register() {
    if (!served || !('serviceWorker' in navigator)) return null;
    tried = true;
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) C.bus.emit('pwa:update', () => w.postMessage('skipWaiting'));
      });
    });
    // Reload only when a new worker replaces an old one. The first install's clients.claim()
    // also fires controllerchange, and reloading then would interrupt the first visit.
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
    return reg;
  }
  function toastUpdate(reload) {
    const t = document.getElementById('toast');
    if (!t) { reload(); return; }
    t.textContent = '';
    t.className = 'toast show';
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Update available: tap to reload';
    b.style.cssText = 'background:transparent;color:#fff;border:0;font:inherit;cursor:pointer';
    b.onclick = () => reload();
    t.appendChild(b);
  }
  async function shareOrDownload(name, blob) {
    const f = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if ((standalone || navigator.canShare) && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: name }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    C.download(name, blob); return 'downloaded';
  }
  async function persist() {
    try { return !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); }
    catch (e) { return false; }
  }
  async function cacheName() {
    const sw = await (await fetch('sw.js', { cache: 'no-store' })).text();
    const m = sw.match(/const CACHE = '([^']+)'/);
    return m ? m[1] : null;
  }
  async function makeOffline(onProgress) {
    const name = await cacheName(); if (!name || !('caches' in window)) return { ok: false, count: 0 };
    const cache = await caches.open(name);
    const files = ['./', 'index.html', 'manifest.webmanifest', 'sw.js'];
    try {
      const cat = await (await fetch('assets/catalog.json', { cache: 'no-store' })).json();
      for (const a of cat.assets || []) for (const k of ['svg', 'png', 'thumb']) if (a.files && a.files[k]) files.push('assets/' + a.files[k]);
      if (cat) { files.push('assets/catalog.json', 'assets/palettes.json'); }
    } catch (e) { /* no catalog on this copy */ }
    let done = 0;
    for (const f of files) {
      try { const r = await fetch(f); if (r.ok) await cache.put(f, r); } catch (e) { /* skip missing */ }
      done++; if (onProgress) onProgress(done, files.length);
    }
    return { ok: true, count: files.length };
  }
  C.pwa = C.registerModule('pwa', {
    register, shareOrDownload, persist, makeOffline,
    get tried() { return tried; },
    get standalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
  });
  C.bus.on('pwa:update', toastUpdate);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
  else register();
})();
