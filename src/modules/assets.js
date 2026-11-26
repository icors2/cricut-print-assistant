/* Asset library: merges bundled, fetched and IndexedDB packs. Never touches the network on file://. */
(function () {
  'use strict';
  const C = window.CST, SCHEMA = 'cpa-catalog/1', PUBLIC_LICENSES = new Set(['CC0-1.0']);
  const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+){2}$/, SOURCES = ['original', 'ai-generated-by-owner', 'cc0-third-party'];
  const state = { source: 'none', packs: [], byId: new Map(), warnings: [], palettes: [], avatar: null, files: {} };
  const textCache = new Map(), LRU = 64;

  function validateCatalog(cat, opt) {
    opt = opt || {};
    const err = [], E = (path, msg) => err.push({ path, msg });
    if (!cat || cat.schema !== SCHEMA) { E('schema', 'must be "' + SCHEMA + '"'); return err; }
    if (!cat.pack || !/^[a-z0-9]+$/.test(cat.pack.id || '')) E('pack.id', 'lowercase letters/digits');
    const cats = new Set((cat.categories || []).map(c => c.id)), seen = new Set();
    (cat.assets || []).forEach((a, i) => {
      const p = 'assets[' + i + ']';
      if (!ID_RE.test(a.id || '')) E(p + '.id', 'bad id (pack.category.slug)');
      else if (seen.has(a.id)) E(p + '.id', 'duplicate id ' + a.id);
      else if (cat.pack && a.id && !a.id.startsWith(cat.pack.id + '.')) E(p + '.id', 'must start with the pack id');
      if (a.id) seen.add(a.id);
      if (!a.name || a.name.length > 40) E(p + '.name', '1-40 characters');
      if (!cats.has(a.category)) E(p + '.category', 'unknown category ' + a.category);
      const s = a.size || {}; if (!(s.w >= 0.25 && s.w <= 11 && s.h >= 0.25 && s.h <= 11)) E(p + '.size', 'w/h in inches, 0.25-11');
      if (!a.files || !(a.files.svg || a.files.png)) E(p + '.files', 'needs svg or png');
      if (!a.files || !a.files.thumb) E(p + '.files.thumb', 'required (run tools/build_assets.js)');
      if (!['contour', 'rect', 'rounded'].includes(a.cut && a.cut.shape)) E(p + '.cut.shape', 'contour|rect|rounded');
      (a.regions || []).forEach((r, k) => {
        if (!/^[a-z][a-z0-9-]*$/.test(r.id || '')) E(p + '.regions[' + k + '].id', 'kebab-case');
        if (!/^#[0-9a-f]{6}$/.test(r.default || '')) E(p + '.regions[' + k + '].default', '#rrggbb');
      });
      if (!a.license) E(p + '.license', 'required');
      else if (opt.publicRepo && !PUBLIC_LICENSES.has(a.license)) E(p + '.license', 'public assets must be CC0-1.0');
      if (!SOURCES.includes(a.source)) E(p + '.source', SOURCES.join('|'));
      if (a.source === 'ai-generated-by-owner' && !a.tool) E(p + '.tool', 'required for AI-generated art');
      if (a.source === 'cc0-third-party' && !a.sourceUrl) E(p + '.sourceUrl', 'required for third-party CC0');
      if (opt.fileExists && a.files) ['svg', 'png', 'thumb'].forEach(k => { if (a.files[k] && !opt.fileExists(a.files[k])) E(p + '.files.' + k, 'missing file ' + a.files[k]); });
    });
    return err;
  }

  function addPack(cat, src, resolver) {
    const errs = validateCatalog(cat, { publicRepo: src === 'public' });
    if (errs.length) {
      if (src !== 'public') throw Object.assign(new Error('Invalid pack'), { errors: errs });
      state.warnings.push.apply(state.warnings, errs.map(e => 'catalog: ' + e.path + ' ' + e.msg));
    }
    const pack = { id: cat.pack.id, meta: cat.pack, src, resolver, categories: cat.categories || [] };
    state.packs.push(pack);
    (cat.assets || []).forEach(a => {
      if (state.byId.has(a.id)) { state.warnings.push('duplicate id skipped: ' + a.id); return; }
      state.byId.set(a.id, Object.assign({ pack: pack.id }, a));
    });
    return pack;
  }

  function decodeDataURL(u) {
    const i = u.indexOf(','), h = u.slice(0, i), b = u.slice(i + 1);
    if (/;base64/.test(h)) { const bin = atob(b); try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; } }
    return decodeURIComponent(b);
  }

  async function load() {
    const bundled = document.getElementById('cstAssets');
    if (bundled && bundled.textContent && bundled.textContent !== 'null') {
      const B = JSON.parse(bundled.textContent);
      state.files = B.files || {};
      state.palettes = (B.palettes && B.palettes.palettes) || [];
      state.avatar = B.avatar || null;
      addPack(B.catalog, 'public', (p) => state.files[p]);
      state.source = 'bundled';
    } else if (/^https?:$/.test(location.protocol)) {
      try {
        const r = await fetch('assets/catalog.json', { cache: 'no-cache' });
        if (r.ok) {
          addPack(await r.json(), 'public', (p) => 'assets/' + p);
          state.source = 'fetch';
          try { const pal = await fetch('assets/palettes.json', { cache: 'no-cache' }); if (pal.ok) { const P = await pal.json(); state.palettes = P.palettes || []; } } catch (e) { /* no palettes */ }
          try { const av = await fetch('assets/avatar/parts.json', { cache: 'no-cache' }); if (av.ok) state.avatar = await av.json(); } catch (e) { /* no avatar parts */ }
        }
      } catch (e) { state.warnings.push('catalog fetch failed: ' + e.message); }
    }
    if (C.idbPacks) { for (const p of await C.idbPacks()) addPack(p.catalog, 'pack', (path) => C.idbFileURL(p.id, path)); if (state.source === 'none' && state.packs.length) state.source = 'pack'; }
    C.bus.emit('assets:ready', { source: state.source, count: state.byId.size });
  }

  async function file(asset, kind) {
    const pack = state.packs.find(p => p.id === asset.pack);
    const path = asset.files && (kind === 'svg' || kind === 'png' || kind === 'thumb' ? asset.files[kind] : null);
    if (!pack || !path) return null;
    const url = await pack.resolver(path);
    if (url == null) return null;
    if (kind !== 'svg') return url;
    const key = asset.id + '|svg';
    if (textCache.has(key)) { const v = textCache.get(key); textCache.delete(key); textCache.set(key, v); return v; }
    const text = String(url).startsWith('data:') ? decodeDataURL(url) : await (await fetch(url)).text();
    textCache.set(key, text); if (textCache.size > LRU) textCache.delete(textCache.keys().next().value);
    return text;
  }

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function search(q, cat) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return [...state.byId.values()]
      .filter(a => (!cat || a.category === cat) && words.every(w => norm(a.name).includes(w) || (a.tags || []).some(t => norm(t).includes(w))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function sameRecolor(a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null); }
  async function toDataURL(url) {
    if (!url) return null;
    if (String(url).startsWith('data:')) return url;
    const b = await (await fetch(url)).blob();
    return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
  }
  async function addAsset(asset, opt) {
    opt = opt || {};
    const isSvg = !!asset.files.svg;
    const existing = C.items.find(it => it.asset && it.asset.id === asset.id && sameRecolor(it.asset.recolor, opt.recolor || null));
    if (existing && !opt.forceNew) {
      const n = C.mkAdd(existing); C.mkSelect(n); C.mkCommit(); C.refresh(true);
      if (C.toast) C.toast(asset.name + ' added');
      return existing;
    }
    let dataURL;
    if (isSvg) {
      let t = await file(asset, 'svg');
      if (opt.recolor && C.recolor) t = C.recolor.apply(t, opt.recolor, asset.regions);
      dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t)));
    } else {
      dataURL = await toDataURL(await file(asset, 'png'));
      if (opt.recolor && C.recolor && asset.files.masks) {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataURL; });
        const masks = {};
        for (const rid of Object.keys(asset.files.masks)) {
          const u = await packFile(asset, asset.files.masks[rid]);
          masks[rid] = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
        }
        const canvas = C.recolor.tintPNG(img, masks, opt.recolor, asset.regions);
        dataURL = canvas.toDataURL('image/png'); canvas.width = 0;
      }
    }
    const meta = state.packs.find(p => p.id === asset.pack);
    const it = await C.addFromDataURL(asset.name, dataURL, dataURL, isSvg, {
      wIn: asset.size.w, hIn: asset.size.h, shape: asset.cut.shape, offsetIn: asset.cut.offset || 0,
      asset: { id: asset.id, pack: asset.pack, packVersion: meta && meta.meta.version, kind: isSvg ? 'svg' : 'png', recolor: opt.recolor || null, avatar: null }
    });
    const n = C.mkAdd(it); C.mkSelect(n); C.mkCommit(); C.refresh(true);
    if (C.rememberAsset) C.rememberAsset(asset.id);
    return it;
  }
  async function packFile(asset, path) {
    const pack = state.packs.find(p => p.id === asset.pack);
    const url = pack && await pack.resolver(path);
    if (!url) return null;
    if (String(url).startsWith('data:') || String(url).startsWith('blob:')) return url;
    return toDataURL(url);
  }

  C.assets = C.registerModule('assets', {
    load, file, search, addAsset, validateCatalog, addPack,
    get: (id) => state.byId.get(id),
    list: () => [...state.byId.values()],
    categories: () => state.packs.flatMap(p => p.categories).sort((a, b) => (a.order || 0) - (b.order || 0)),
    palettes: () => state.palettes.slice(),
    avatarParts: () => state.avatar,
    partFile: async (part) => {
      const hit = state.files[part.file];
      if (hit) return String(hit).startsWith('data:') ? decodeDataURL(hit) : hit;
      if (/^https?:$/.test(location.protocol)) { const r = await fetch('assets/' + part.file); if (r.ok) return r.text(); }
      return null;
    },
    get source() { return state.source; },
    get warnings() { return state.warnings.slice(); },
    get packs() { return state.packs.map(p => ({ id: p.id, meta: p.meta, src: p.src, count: [...state.byId.values()].filter(a => a.pack === p.id).length })); },
  });
  if (document.readyState !== 'loading') load(); else document.addEventListener('DOMContentLoaded', load);
})();
