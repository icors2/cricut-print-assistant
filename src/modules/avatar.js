/* Avatar builder core: composes one layered SVG from parts.json + a spec. */
(function () {
  'use strict';
  const C = window.CST;
  const partSvg = new Map();
  function cat() { return C.assets && C.assets.avatarParts(); }
  function partsById() { const P = cat(); return new Map((P && P.parts || []).map(p => [p.id, p])); }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const isRaster = (part) => part.kind === 'raster' || /\.(png|webp|jpe?g)$/i.test(part.file || '');
  // Body-specific parts list the bodies they fit in `bodies`. A body marked `exclusive` only takes parts that list it.
  function fits(part, bodyId) {
    if (!part || part.slot === 'body') return true;
    if (part.bodies && part.bodies.length) return !!bodyId && part.bodies.includes(bodyId);
    const body = bodyId && partsById().get(bodyId);
    return !(body && body.exclusive);
  }
  // Required slots come from the parts.json that the chosen body belongs to.
  function requiredSlots(spec) {
    const P = cat(), body = spec && spec.parts && spec.parts.body && partsById().get(spec.parts.body);
    const src = body ? body._pack : (P.sources || [])[0];
    if (P.requiredBy && src && P.requiredBy[src]) return P.requiredBy[src];
    return P.slots.filter(s => s.required).map(s => s.id);
  }
  // Drop parts that don't fit the chosen body (e.g. after switching animals). Returns a new spec.
  function clean(spec) {
    const out = JSON.parse(JSON.stringify(spec || {})), parts = partsById(), body = (out.parts || {}).body;
    for (const [slot, id] of Object.entries(out.parts || {})) if (id && slot !== 'body' && !fits(parts.get(id), body)) out.parts[slot] = null;
    return out;
  }
  function validate(spec) {
    const P = cat(); if (!P) return ['parts unavailable'];
    const err = [], slots = new Set(P.slots.map(s => s.id)), parts = partsById();
    for (const id of requiredSlots(spec)) if (!(spec.parts || {})[id]) err.push('missing ' + id);
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
    for (const id of Object.values(spec.parts || {})) { const p = id && parts.get(id), q = p && p.pairs && parts.get(p.pairs); if (q && !chosen[q.slot]) chosen[q.slot] = p.pairs; }
    for (const id of Object.values(chosen)) { const p = id && parts.get(id); if (!p) continue; for (const [slot, sid] of Object.entries(p.swapTo || {})) chosen[slot] = sid; }
    for (const id of Object.values(chosen)) { const p = id && parts.get(id); if (!p) continue; for (const h of p.hides || []) chosen[h] = null; }
    const z = new Map(P.slots.map((s, i) => [s.id, s.z * 1000 + i]));
    return Object.entries(chosen).filter(([, id]) => id).map(([slot, id]) => ({ slot, part: parts.get(id) })).filter(x => x.part && z.has(x.slot) && fits(x.part, chosen.body)).sort((a, b) => z.get(a.slot) - z.get(b.slot));
  }
  async function svgOf(part) {
    const key = (part._pack || 'core') + '|' + part.id;
    if (partSvg.has(key)) return partSvg.get(key);
    const t = await C.assets.partFile(part);
    if (t && C.assets.badPartSvg && C.assets.badPartSvg(t)) throw new Error('part has unsafe SVG: ' + part.id);
    if (t) partSvg.set(key, t);
    return t;
  }
  function tplOf(part) { return (C.assets.avatarTemplate && C.assets.avatarTemplate(part)) || cat().template; }
  // The output artboard is the chosen body's template (else the first source's). Parts drawn on another
  // template are mapped onto it, viewBox to viewBox, so packs with different artboard sizes mix.
  function outTemplate(spec) {
    const body = spec && spec.parts && spec.parts.body && partsById().get(spec.parts.body);
    return body ? tplOf(body) : cat().template;
  }
  function mapper(from, to) {
    const [fx, fy, fw, fh] = from.viewBox, [tx, ty, tw, th] = to.viewBox, sx = tw / fw, sy = th / fh;
    return { sx, sy, pt: (p) => [tx + (p[0] - fx) * sx, ty + (p[1] - fy) * sy], same: sx === 1 && sy === 1 && fx === tx && fy === ty };
  }
  // §4.5 follows: shift by bodyAnchor − templateAnchor, both in output units. A body may declare its own anchors.
  function followOffset(part, spec, out) {
    if (!part.follows || part.slot === 'body') return [0, 0];
    const body = spec.parts && spec.parts.body && partsById().get(spec.parts.body);
    const ptT = tplOf(part), bT = body ? tplOf(body) : out;
    const a = (body && body.anchors && body.anchors[part.follows]) || (bT.anchors || {})[part.follows];
    const b = (ptT.anchors || {})[part.follows];
    if (!a || !b) return [0, 0];
    const A = mapper(bT, out).pt(a), B = mapper(ptT, out).pt(b);
    return [Math.round((A[0] - B[0]) * 100) / 100, Math.round((A[1] - B[1]) * 100) / 100];
  }
  async function compose(spec) {
    const P = cat(); if (!P) throw new Error("These avatar parts aren't available here.");
    const err = validate(spec); if (err.length) throw new Error(err.join('; '));
    const T = outTemplate(spec), [x, y, w, h] = T.viewBox, layers = [];
    for (const { slot, part } of resolve(spec)) {
      const m = mapper(tplOf(part), T), [dx, dy] = followOffset(part, spec, T), tf = [];
      if (dx || dy) tf.push('translate(' + dx + ' ' + dy + ')');
      if (!m.same) { const [fx, fy] = tplOf(part).viewBox; tf.push('translate(' + x + ' ' + y + ') scale(' + +m.sx.toFixed(6) + ' ' + +m.sy.toFixed(6) + ') translate(' + -fx + ' ' + -fy + ')'); }
      const open = '<g data-slot="' + slot + '" data-part="' + part.id + '"' + (tf.length ? ' transform="' + tf.join(' ') + '"' : '') + '>';
      if (isRaster(part)) {
        // A raster part covers its whole artboard (same canvas as its body, stacked with zero offset).
        const key = (part._pack || 'core') + '|' + part.id + '|img';
        let u = partSvg.get(key); if (!u) { u = await C.assets.partDataURL(part); if (u) partSvg.set(key, u); }
        if (!u || !/^data:image\/(png|webp|jpeg);/.test(u)) throw new Error('part not loaded: ' + part.id);
        const [fx, fy, fw, fh] = tplOf(part).viewBox;
        layers.push(open + '<image href="' + u + '" x="' + fx + '" y="' + fy + '" width="' + fw + '" height="' + fh + '" preserveAspectRatio="none"/></g>');
        continue;
      }
      let t = await svgOf(part); if (!t) throw new Error('part not loaded: ' + part.id);
      const map = {};
      for (const [cs, def] of Object.entries(P.colorSlots || {})) for (const r of def.regions) if ((part.regions || []).includes(r)) map[r] = (spec.colors || {})[cs] || def.default;
      Object.assign(map, (spec.partColors || {})[part.id] || {});
      if (Object.keys(map).length) t = C.recolor.apply(t, map);
      const pre = part.id.replace(/[^a-z0-9]/gi, '_') + '__';
      const inner = t.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
        .replace(/\bid="([^"]+)"/g, 'id="' + pre + '$1"').replace(/url\(#([^)]+)\)/g, 'url(#' + pre + '$1)').replace(/href="#([^"]+)"/g, 'href="#' + pre + '$1"');
      layers.push(open + inner + '</g>');
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x + ' ' + y + ' ' + w + ' ' + h + '" width="' + T.sizeIn.w + 'in" height="' + T.sizeIn.h + 'in" data-cst-natw-in="' + T.sizeIn.w + '">' + layers.join('') + '</svg>';
  }
  function randomize(seed, locks, base) {
    const P = cat(); if (!P) return base || { parts: {} };
    const r = rng(seed), spec = base ? JSON.parse(JSON.stringify(base)) : { schema: 'cpa-avatar-spec/1', template: P.template.id, parts: {}, colors: {}, partColors: {} };
    spec.seed = seed; locks = locks || {}; spec.parts = spec.parts || {};
    const order = P.slots.filter(s => s.id === 'body').concat(P.slots.filter(s => s.id !== 'body'));
    for (const s of order) {
      if (locks[s.id]) continue;
      const opts = P.parts.filter(p => p.slot === s.id && !p.hiddenInPicker && fits(p, spec.parts.body));
      if (!opts.length) { spec.parts[s.id] = null; continue; }
      const req = s.id === 'body' || requiredSlots(spec).includes(s.id);
      spec.parts[s.id] = (!req && r() < 0.25) ? null : opts[Math.floor(r() * opts.length)].id;
    }
    return clean(spec);
  }
  async function toItem(spec) {
    const svg = await compose(spec), T = outTemplate(spec);
    const dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const it = await C.addFromDataURL(spec.name || 'Avatar', dataURL, dataURL, true, {
      wIn: T.sizeIn.w, hIn: T.sizeIn.h, shape: 'contour', offsetIn: 0.04,
      asset: { id: null, pack: null, packVersion: null, kind: 'avatar', recolor: null, avatar: spec }
    });
    const q = C.processed(it, false);
    if (q.loops && q.loops.length > 1) C.toast('This avatar cuts as ' + q.loops.length + ' pieces. Overlap the parts so it is one sticker.');
    const n = C.mkAdd(it); C.mkSelect(n); C.mkCommit(); C.refresh(true);
    return it;
  }
  C.avatar = C.registerModule('avatar', { compose, validate, resolve, randomize, toItem, followOffset, outTemplate, fits, clean, requiredSlots, isRaster });
})();
