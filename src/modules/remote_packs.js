/* Optional "Sync family packs": fetch private packs listed in a remote pack index.
   Off by default. It turns on only when <meta name="cpa-pack-index" content="…"> (set by
   `build.py --pack-index URL` in a private build) or localStorage "cst.packIndex" names an
   index URL. The index (schema cpa-pack-index/1) lists packs by id and version; a pack is
   downloaded (whole file or in parts), checked, and imported into IndexedDB with the normal
   pack import, so it works offline afterwards. Packs already imported at the same version
   are skipped. Same-origin only, so a sign-in in front of the site (for example Cloudflare
   Access) also protects the packs. */
(function () {
  'use strict';
  const C = window.CST;
  const INDEX_SCHEMA = 'cpa-pack-index/1';
  let running = null;

  function indexURL() {
    let u = '';
    try { u = (localStorage.getItem('cst.packIndex') || '').trim(); } catch (e) { /* ignore */ }
    if (!u) { const m = document.querySelector('meta[name="cpa-pack-index"]'); u = m ? (m.getAttribute('content') || '').trim() : ''; }
    return u;
  }
  function enabled() { return !!indexURL() && /^https?:$/.test(location.protocol); }

  async function get(url) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
    if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw Object.assign(new Error('Sign-in needed: reload the page and sign in again'), { code: 'auth' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r;
  }
  async function sha256Hex(buf) {
    if (!(window.crypto && crypto.subtle)) return '';
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
  }
  function say(msg) { if (C.toast) C.toast(msg); }

  async function syncNow(opt) {
    opt = opt || {};
    const url = indexURL();
    const out = { enabled: enabled(), added: [], skipped: [], errors: [] };
    if (!out.enabled) return out;
    if (navigator.onLine === false) { out.errors.push('offline'); return out; }
    const base = new URL(url, location.href);
    if (base.origin !== location.origin) { out.errors.push('pack index must be same-origin'); return out; }
    let idx;
    try { idx = await (await get(base.href)).json(); } catch (e) { out.errors.push(e.message); if (!opt.quiet || e.code === 'auth') say('Family packs: ' + e.message); return out; }
    if (!idx || idx.schema !== INDEX_SCHEMA || !Array.isArray(idx.packs)) { out.errors.push('not a ' + INDEX_SCHEMA + ' index'); return out; }
    const have = new Map((C.idbPacks ? await C.idbPacks() : []).map(r => [r.id, String((r.meta && r.meta.version) || '')]));
    const todo = idx.packs.filter(p => p && p.id && !(have.has(p.id) && have.get(p.id) === String(p.version || '')));
    idx.packs.forEach(p => { if (p && p.id && !todo.includes(p)) out.skipped.push(p.id); });
    if (!todo.length) { if (!opt.quiet) say('Family packs are up to date'); return out; }
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ignore */ }
    let n = 0;
    for (const p of todo) {
      n++;
      try {
        say('Downloading family packs ' + n + ' of ' + todo.length + ': ' + (p.name || p.id) + '…');
        const urls = (Array.isArray(p.parts) && p.parts.length ? p.parts : [p.url || p.file]).map(u => new URL(u, base).href);
        const chunks = [];
        for (const u of urls) {
          if (new URL(u).origin !== location.origin) throw new Error('pack files must be same-origin');
          chunks.push(await (await get(u)).arrayBuffer());
        }
        const blob = new Blob(chunks);
        if (p.bytes && blob.size !== p.bytes) throw new Error('size mismatch (' + blob.size + ' ≠ ' + p.bytes + ')');
        if (p.sha256) { const h = await sha256Hex(await blob.arrayBuffer()); if (h && h !== String(p.sha256).toLowerCase()) throw new Error('checksum mismatch'); }
        const name = p.file || (p.id + (/json/.test(String(p.type || '')) ? '.cpapack.json' : '.cpapack.zip'));
        await C.assets_ui.importPack(new File([blob], name, { type: /\.json$/i.test(name) ? 'application/json' : 'application/zip' }));
        out.added.push(p.id);
      } catch (e) {
        out.errors.push(p.id + ': ' + e.message);
        if (e.code === 'auth') break;
      }
    }
    say(out.errors.length ? 'Family packs: ' + out.added.length + ' added, ' + out.errors.length + ' failed (' + out.errors[0] + ')'
      : 'Family packs: ' + out.added.length + ' added' + (out.skipped.length ? ', ' + out.skipped.length + ' already here' : ''));
    if (out.added.length) C.bus.emit('packs:synced', out);
    return out;
  }
  function sync(opt) {
    if (!running) running = syncNow(opt).finally(() => { running = null; });
    return running;
  }

  function boot() {
    if (!enabled()) return;
    const imp = document.getElementById('packImport');
    if (imp && !document.getElementById('packSync')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'packSync'; b.textContent = '⟳ Sync family packs';
      b.onclick = async () => { b.disabled = true; try { await sync({ quiet: false }); } finally { b.disabled = false; } if (C.assets_ui) C.assets_ui.paint(); };
      imp.insertAdjacentElement('afterend', b);
    }
    // Auto-sync once on start, after the library has loaded; quiet when there is nothing new.
    let started = false;
    const go = () => { if (started) return; started = true; setTimeout(() => sync({ quiet: true }).then(() => { if (C.assets_ui) C.assets_ui.paint(); }), 300); };
    C.bus.on('assets:ready', go);
    setTimeout(go, 4000);
  }
  C.remotePacks = C.registerModule('remote_packs', { indexURL, enabled, sync, boot });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
