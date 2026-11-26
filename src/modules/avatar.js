/* Avatar builder core: composes one layered SVG from parts.json + a spec. */
(function () {
  'use strict';
  const C = window.CST;
  const partSvg = new Map();
  function cat() { return C.assets && C.assets.avatarParts(); }
  function partsById() { const P = cat(); return new Map((P && P.parts || []).map(p => [p.id, p])); }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function validate(spec) {
    const P = cat(); if (!P) return ['parts unavailable'];
    const err = [], slots = new Set(P.slots.map(s => s.id)), parts = partsById();
    for (const s of P.slots) if (s.required && !(spec.parts || {})[s.id]) err.push('missing ' + s.id);
    for (const [slot, id] of Object.entries(spec.parts || {})) {
      if (!slots.has(slot)) err.push('unknown slot ' + slot);
      if (!id) continue;
      const p = parts.get(id);
      if (!p) err.push('unknown part ' + id); else if (p.slot !== slot) err.push(id + ' is a ' + p.slot + ', not a ' + slot);
    }
    return err;
  }
  function resolve(spec) {
    const P = cat(); if (!P) return [];
    const parts = partsById(), chosen = Object.assign({}, spec.parts);
    for (const id of Object.values(spec.parts || {})) { const p = id && parts.get(id); if (p && p.pairs && !chosen[parts.get(p.pairs).slot]) chosen[parts.get(p.pairs).slot] = p.pairs; }
    for (const id of Object.values(chosen)) { const p = id && parts.get(id); if (!p) continue; for (const [slot, sid] of Object.entries(p.swapTo || {})) chosen[slot] = sid; }
    for (const id of Object.values(chosen)) { const p = id && parts.get(id); if (!p) continue; for (const h of p.hides || []) chosen[h] = null; }
    const z = new Map(P.slots.map((s, i) => [s.id, s.z * 1000 + i]));
    return Object.entries(chosen).filter(([, id]) => id).map(([slot, id]) => ({ slot, part: parts.get(id) })).filter(x => x.part).sort((a, b) => z.get(a.slot) - z.get(b.slot));
  }
  async function svgOf(part) {
    if (partSvg.has(part.id)) return partSvg.get(part.id);
    const t = await C.assets.partFile(part);
    if (t) partSvg.set(part.id, t);
    return t;
  }
  async function compose(spec) {
    const P = cat(); if (!P) throw new Error("These avatar parts aren't available here.");
    const err = validate(spec); if (err.length) throw new Error(err.join('; '));
    const T = P.template, [x, y, w, h] = T.viewBox, layers = [];
    for (const { slot, part } of resolve(spec)) {
      let t = await svgOf(part); if (!t) throw new Error('part not loaded: ' + part.id);
      const map = {};
      for (const [cs, def] of Object.entries(P.colorSlots || {})) for (const r of def.regions) if ((part.regions || []).includes(r)) map[r] = (spec.colors || {})[cs] || def.default;
      Object.assign(map, (spec.partColors || {})[part.id] || {});
      if (Object.keys(map).length) t = C.recolor.apply(t, map);
      const pre = part.id.replace(/[^a-z0-9]/gi, '_') + '__';
      const inner = t.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
        .replace(/\bid="([^"]+)"/g, 'id="' + pre + '$1"').replace(/url\(#([^)]+)\)/g, 'url(#' + pre + '$1)').replace(/href="#([^"]+)"/g, 'href="#' + pre + '$1"');
      layers.push('<g data-slot="' + slot + '" data-part="' + part.id + '">' + inner + '</g>');
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x + ' ' + y + ' ' + w + ' ' + h + '" width="' + T.sizeIn.w + 'in" height="' + T.sizeIn.h + 'in" data-cst-natw-in="' + T.sizeIn.w + '">' + layers.join('') + '</svg>';
  }
  function randomize(seed, locks, base) {
    const P = cat(); if (!P) return base || { parts: {} };
    const r = rng(seed), spec = base ? JSON.parse(JSON.stringify(base)) : { schema: 'cpa-avatar-spec/1', template: P.template.id, parts: {}, colors: {}, partColors: {} };
    spec.seed = seed; locks = locks || {};
    for (const s of P.slots) {
      if (locks[s.id]) continue;
      const opts = P.parts.filter(p => p.slot === s.id && !p.hiddenInPicker);
      if (!opts.length) { spec.parts[s.id] = null; continue; }
      spec.parts[s.id] = (!s.required && r() < 0.25) ? null : opts[Math.floor(r() * opts.length)].id;
    }
    return spec;
  }
  async function toItem(spec) {
    const svg = await compose(spec);
    const dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const it = await C.addFromDataURL('Avatar', dataURL, dataURL, true, {
      wIn: 2, hIn: 3, shape: 'contour', offsetIn: 0.04,
      asset: { id: null, pack: null, packVersion: null, kind: 'avatar', recolor: null, avatar: spec }
    });
    const q = C.processed(it, false);
    if (q.loops && q.loops.length > 1) C.toast('This avatar cuts as ' + q.loops.length + ' pieces. Overlap the parts so it is one sticker.');
    const n = C.mkAdd(it); C.mkSelect(n); C.mkCommit(); C.refresh(true);
    return it;
  }
  C.avatar = C.registerModule('avatar', { compose, validate, resolve, randomize, toItem });
})();
