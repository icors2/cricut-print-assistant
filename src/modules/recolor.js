/* Recolor. Paint attributes only: the alpha mask, and therefore the cut, never changes. */
(function () {
  'use strict';
  const C = window.CST;
  const HEX = /^#[0-9a-fA-F]{6}$/;
  function apply(svgText, recolor, regions) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('This sticker could not be read.');
    if (doc.querySelector('style')) throw new Error('This sticker uses a style block; recolor it in the file instead.');
    const allowed = regions ? new Set(regions.map(r => r.id)) : null;
    for (const [id, color] of Object.entries(recolor || {})) {
      if (allowed && !allowed.has(id)) continue;
      if (color === 'none' || color === 'transparent' || !HEX.test(color)) throw new Error('Pick a colour for ' + id);
      doc.querySelectorAll('[data-region="' + id + '"]').forEach(el => {
        el.querySelectorAll('use').forEach(u => {
          const ref = u.getAttribute('href') || u.getAttribute('xlink:href');
          const src = ref && doc.querySelector(ref);
          if (src) u.replaceWith(src.cloneNode(true));
        });
        const paint = (n) => {
          if (n.hasAttribute('fill') && n.getAttribute('fill') !== 'none') n.setAttribute('fill', color.toLowerCase());
          if (n.hasAttribute('stroke') && n.getAttribute('stroke') !== 'none') n.setAttribute('stroke', color.toLowerCase());
        };
        paint(el);
        el.querySelectorAll('*').forEach(paint);
      });
    }
    return new XMLSerializer().serializeToString(doc);
  }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255; const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2; let h = 0, s = 0;
    if (M !== m) { const d = M - m; s = l > 0.5 ? d / (2 - M - m) : d / (M + m); h = M === r ? (g - b) / d + (g < b ? 6 : 0) : M === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return Math.round(255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p)); };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  function tintPNG(img, masks, recolor, regions, mode) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, w, h), out = new Uint8ClampedArray(src.data);
    const regionMode = {}; (regions || []).forEach(r => { regionMode[r.id] = r.mode || 'tint'; });
    for (const [rid, color] of Object.entries(recolor || {})) {
      const mask = masks[rid]; if (!mask || !HEX.test(color)) continue;
      const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
      mc.getContext('2d').drawImage(mask, 0, 0, w, h);
      const md = mc.getContext('2d').getImageData(0, 0, w, h).data;
      const rgb = hex(color), how = mode || regionMode[rid] || 'tint';
      const target = rgb2hsl(rgb[0], rgb[1], rgb[2]);
      for (let i = 0; i < out.length; i += 4) {
        const a = md[i] / 255; if (a <= 0) continue;
        const R = src.data[i], G = src.data[i + 1], B = src.data[i + 2];
        let tR, tG, tB;
        if (how === 'hue') { const hsl = rgb2hsl(R, G, B); const n = hsl2rgb(target[0], hsl[1], hsl[2]); tR = n[0]; tG = n[1]; tB = n[2]; }
        else { const luma = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255; tR = rgb[0] * luma; tG = rgb[1] * luma; tB = rgb[2] * luma; }
        out[i] = R + (tR - R) * a; out[i + 1] = G + (tG - G) * a; out[i + 2] = B + (tB - B) * a; out[i + 3] = src.data[i + 3];
      }
    }
    g.putImageData(new ImageData(out, w, h), 0, 0);
    return c;
  }
  function surprise(asset, seed) {
    let s = seed >>> 0; const rnd = () => (s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296;
    const pals = C.assets.palettes().filter(p => (asset.palettes || []).includes(p.id));
    const out = {};
    (asset.regions || []).forEach(r => {
      const pool = []; pals.forEach(p => (p.colors || []).forEach(c => pool.push(c)));
      if (!pool.length) return;
      out[r.id] = pool[Math.floor(rnd() * pool.length)];
    });
    return out;
  }
  C.recolor = C.registerModule('recolor', { apply, tintPNG, surprise });
})();
