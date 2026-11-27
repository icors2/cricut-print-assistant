/* Crop one object out of a picture and describe it as a library catalog entry. Pixel buffers only. */
(function () {
  'use strict';
  const C = window.CST;
  const TOL = 28;
  const AUTHOR = 'Cricut Print Assistant contributors';

  function crop(data, w, h, rect) {
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(rect.x)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(rect.y)));
    const x1 = Math.max(x0, Math.min(w, Math.ceil(rect.x + rect.w)));
    const y1 = Math.max(y0, Math.min(h, Math.ceil(rect.y + rect.h)));
    const tw = Math.max(1, x1 - x0), th = Math.max(1, y1 - y0);
    const out = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0) * 4 + tw * 4), y * tw * 4);
    return { data: out, w: tw, h: th };
  }

  function knockOut(data, w, h, tol) {
    const src = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
    const out = new Uint8ClampedArray(src);
    const limit = tol == null ? TOL : tol;
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
    let cr = 0, cg = 0, cb = 0;
    corners.forEach(i => { cr += out[i]; cg += out[i + 1]; cb += out[i + 2]; });
    cr /= 4; cg /= 4; cb /= 4;
    const close = (i) => Math.abs(out[i] - cr) <= limit && Math.abs(out[i + 1] - cg) <= limit && Math.abs(out[i + 2] - cb) <= limit;
    const seen = new Uint8Array(w * h), q = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = y * w + x;
      if (seen[p] || !close(p * 4)) return;
      seen[p] = 1; q.push(p);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    for (let k = 0; k < q.length; k++) {
      const p = q[k], x = p % w, y = (p / w) | 0;
      out[p * 4 + 3] = 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    return out;
  }

  function trim(data, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const tw = x1 - x0 + 1, th = y1 - y0 + 1, out = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0) * 4 + tw * 4), y * tw * 4);
    return { data: out, w: tw, h: th };
  }

  function prepare(data, w, h, rect, knock) {
    const cropped = crop(data, w, h, rect);
    let cur = cropped, flat = true;
    if (knock) {
      const cleared = knockOut(cropped.data, cropped.w, cropped.h);
      const t = trim(cleared, cropped.w, cropped.h);
      if (!t) flat = false;
      else cur = t;
    } else {
      const t = trim(cropped.data, cropped.w, cropped.h);
      if (t) cur = t;
    }
    let alpha = 0;
    const n = cur.w * cur.h;
    for (let i = 3; i < cur.data.length; i += 4) if (cur.data[i] < 250) alpha++;
    return { data: cur.data, w: cur.w, h: cur.h, hasAlpha: alpha > n * 0.005, flat };
  }

  function slug(name) {
    const s = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return s || 'sticker';
  }

  function sizeIn(pxW, pxH) {
    let w = pxW >= pxH ? 2 : 2 * pxW / pxH;
    let h = pxW >= pxH ? 2 * pxH / pxW : 2;
    let k = Math.min(1, 11 / w, 11 / h);
    w *= k; h *= k;
    k = Math.max(1, 0.25 / w, 0.25 / h);
    w *= k; h *= k;
    if (w > 11 || h > 11) { k = Math.min(11 / w, 11 / h); w *= k; h *= k; }
    const r = (n) => Math.round(n * 1000) / 1000;
    return { w: r(w), h: r(h) };
  }

  function entry(opt) {
    const name = String(opt.name || '').trim();
    const category = opt.category;
    const base = slug(name);
    let id = 'library.' + category + '.' + base, n = 2;
    const taken = opt.taken || (() => false);
    while (taken(id) && n < 50) { id = 'library.' + category + '.' + base + '-' + n; n++; }
    const shape = opt.hasAlpha ? 'contour' : 'rect';
    return {
      id: id, name: name, category: category, tags: [],
      size: sizeIn(opt.pxW, opt.pxH),
      files: { png: 'png/' + id + '.png', thumb: 'thumbs/' + id + '.png' },
      cut: { shape: shape, offset: shape === 'contour' ? 0.04 : 0 },
      license: 'CC0-1.0', author: AUTHOR, source: 'original',
      added: opt.added || new Date().toISOString().slice(0, 10)
    };
  }

  C.extract = C.registerModule('extract', { TOL: TOL, AUTHOR: AUTHOR, crop, knockOut, trim, prepare, slug, sizeIn, entry });
})();
