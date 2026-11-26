/* Cricut Print Assistant - core geometry & raster processing (no DOM UI).
   All real-world units are INCHES unless noted. 72 pt = 1 in. */
(function (global) {
  'use strict';
  const PT = 72, INF = 1e20;

  // ---------- Euclidean distance transform (Felzenszwalb & Huttenlocher) with nearest-feature index ----------
  function dt1(f, n, d, arg, v, z) {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; arg[q] = v[k]; }
  }
  /** mask: Uint8Array (1 = feature). Returns {d2: Float64Array squared distance, near: Int32Array nearest feature index or -1} */
  function edt(mask, w, h, wantIndex) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), arg = new Int32Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const col = new Float64Array(w * h), rowArg = wantIndex ? new Int32Array(w * h) : null;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF;
      dt1(f, h, d, arg, v, z);
      for (let y = 0; y < h; y++) { col[y * w + x] = d[y]; if (rowArg) rowArg[y * w + x] = arg[y]; }
    }
    const d2 = new Float64Array(w * h), near = wantIndex ? new Int32Array(w * h) : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = col[y * w + x];
      dt1(f, w, d, arg, v, z);
      for (let x = 0; x < w; x++) {
        d2[y * w + x] = d[x];
        if (near) { const nx = arg[x], ny = rowArg[y * w + nx]; near[y * w + x] = d[x] >= INF / 2 ? -1 : ny * w + nx; }
      }
    }
    return { d2, near };
  }

  // ---------- binary mask helpers ----------
  function fillHoles(mask, w, h) { // 4-connected background flood from border
    const out = new Uint8Array(w * h), stack = new Int32Array(w * h); let sp = 0;
    const push = (i) => { if (!mask[i] && !out[i]) { out[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) { const i = stack[--sp], x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
    const r = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) r[i] = out[i] ? 0 : 1; return r;
  }
  function dropSmallComponents(mask, w, h, minFrac, minPx) { // 8-connected
    const lab = new Int32Array(w * h), stack = new Int32Array(w * h), areas = [0]; let L = 0;
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue; L++; let sp = 0, a = 0; stack[sp++] = s; lab[s] = L;
      while (sp) { const i = stack[--sp]; a++; const x = i % w, y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx; if (mask[j] && !lab[j]) { lab[j] = L; stack[sp++] = j; } } }
      areas.push(a);
    }
    const max = Math.max(0, ...areas), keep = areas.map(a => a >= Math.max(minPx, max * minFrac));
    const out = new Uint8Array(w * h); let kept = 0;
    for (let i = 0; i < w * h; i++) if (lab[i] && keep[lab[i]]) out[i] = 1;
    for (let l = 1; l <= L; l++) if (keep[l]) kept++;
    return { mask: out, components: kept };
  }

  // ---------- marching squares on a binary mask (pixel centers), returns closed loops in pixel coords ----------
  function marchingSquares(mask, w, h) {
    const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];
    const hKey = (x, y) => (2 * x + 2) * 1048576 + (2 * y + 1); // edge between centers (x,y)-(x+1,y)
    const vKey = (x, y) => (2 * x + 1) * 1048576 + (2 * y + 2); // edge between centers (x,y)-(x,y+1)
    const segs = [], byKey = new Map();
    const add = (k1, k2) => { const i = segs.length; segs.push([k1, k2]);
      for (const k of [k1, k2]) { const l = byKey.get(k); if (l) l.push(i); else byKey.set(k, [i]); } };
    for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
      const c = (get(x, y) << 3) | (get(x + 1, y) << 2) | (get(x + 1, y + 1) << 1) | get(x, y + 1);
      if (c === 0 || c === 15) continue;
      const T = hKey(x, y), B = hKey(x, y + 1), Lf = vKey(x, y), R = vKey(x + 1, y);
      switch (c) {
        case 1: case 14: add(Lf, B); break;
        case 2: case 13: add(B, R); break;
        case 3: case 12: add(Lf, R); break;
        case 4: case 11: add(T, R); break;
        case 6: case 9: add(T, B); break;
        case 7: case 8: add(Lf, T); break;
        case 5: add(Lf, T); add(B, R); break;   // saddle: inside treated 8-connected
        case 10: add(T, R); add(Lf, B); break;
      }
    }
    const used = new Uint8Array(segs.length), loops = [];
    const kxy = (k) => [Math.floor(k / 1048576) / 2 - 0.5 + 0.5, (k % 1048576) / 2]; // doubled coords -> px (center of pixel x is x+0.5)
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue; used[s] = 1;
      const start = segs[s][0]; let cur = segs[s][1]; const keys = [start, cur]; let closed = false, guard = 0;
      while (guard++ < segs.length + 5) {
        if (cur === start) { closed = true; keys.pop(); break; }
        const cand = byKey.get(cur); let next = -1;
        for (const i of cand) if (!used[i]) { next = i; break; }
        if (next < 0) break;
        used[next] = 1; const sg = segs[next]; cur = sg[0] === cur ? sg[1] : sg[0]; keys.push(cur);
      }
      if (keys.length >= 3) loops.push({ pts: keys.map(kxy), closed });
    }
    return loops;
  }
  function signedArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
  function rdp(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [a, b] = st.pop(); const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
      let md = -1, mi = -1; for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return pts.filter((_, i) => keep[i]);
  }
  function simplifyClosed(p, tol) {
    if (p.length < 8) return p;
    let fi = 0, fd = -1; for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; fi = i; } }
    const a = rdp(p.slice(0, fi + 1), tol), b = rdp(p.slice(fi).concat([p[0]]), tol);
    const r = a.slice(0, -1).concat(b.slice(0, -1)); return r.length >= 3 ? r : p;
  }

  // ---------- path representation: loops of segments ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z'] ----------
  function polyLoop(pts) { const s = [['M', pts[0][0], pts[0][1]]]; for (let i = 1; i < pts.length; i++) s.push(['L', pts[i][0], pts[i][1]]); s.push(['Z']); return s; }
  function roundedRectLoop(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r < 1e-6) return polyLoop([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    const k = 0.5522847498 * r;
    return [['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r], ['L', x + w, y + h - r],
      ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h], ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r],
      ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y], ['Z']];
  }
  function mapLoop(loop, fn) { return loop.map(s => { if (s[0] === 'Z') return ['Z']; const o = [s[0]]; for (let i = 1; i < s.length; i += 2) { const [a, b] = fn(s[i], s[i + 1]); o.push(a, b); } return o; }); }
  function loopBBox(loops) { let x0 = INF, y0 = INF, x1 = -INF, y1 = -INF;
    for (const l of loops) for (const s of l) for (let i = 1; i < s.length; i += 2) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]); }
    return { x0, y0, x1, y1 }; }
  function loopToD(loop, scale, dx, dy, prec) {
    const f = (v) => (+v.toFixed(prec)).toString();
    return loop.map(s => s[0] === 'Z' ? 'Z' : s[0] + s.slice(1).map((v, i) => f(i % 2 === 0 ? (v + dx) * scale : (v + dy) * scale)).join(' ')).join('');
  }

  // ---------- image processing per item ----------
  function makeCanvas(w, h) { const c = (typeof OffscreenCanvas !== 'undefined' && !global.document) ? new OffscreenCanvas(w, h) : global.document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rasterize(src, pw, ph) { const c = makeCanvas(pw, ph), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, pw, ph); return g.getImageData(0, 0, pw, ph); }

  /** opts: {wIn,hIn, shape:'rect'|'rounded'|'contour', radiusIn, offsetIn, bleedIn, border:'extend'|'white', dpi, alphaThreshold}
      returns {cutW,cutH, loops (inches, relative to cut bbox top-left), print:{canvas, x,y,w,h (in, rel to cut bbox), hasAlpha}, info} */
  function processItem(src, o) {
    const dpi = o.dpi, b = Math.max(0, o.bleedIn), off = Math.max(0, o.offsetIn || 0);
    const iw = Math.max(2, Math.round(o.wIn * dpi)), ih = Math.max(2, Math.round(o.hIn * dpi));
    const img = rasterize(src, iw, ih), ip = img.data;
    if (o.shape !== 'contour') {
      const cutW = o.wIn + 2 * off, cutH = o.hIn + 2 * off, r = o.shape === 'rounded' ? (o.radiusIn || 0) : 0;
      const loops = [roundedRectLoop(0, 0, cutW, cutH, r)];
      const pw = Math.round((cutW + 2 * b) * dpi), ph = Math.round((cutH + 2 * b) * dpi);
      const c = makeCanvas(pw, ph), g = c.getContext('2d'), od = g.createImageData(pw, ph), op = od.data;
      const ox = (b + off) * dpi, oy = (b + off) * dpi; // image origin in print px
      const rr = r > 0 ? (r + b) * dpi : 0, W = pw, H = ph; let anyAlpha = false;
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        if (rr > 0) { // clip outside rounded print region
          const qx = Math.max(rr - cx, 0, cx - (W - rr)), qy = Math.max(rr - cy, 0, cy - (H - rr));
          if (qx > 0 && qy > 0 && qx * qx + qy * qy > rr * rr) { anyAlpha = true; continue; }
        }
        const u = cx - ox, v = cy - oy, inside = u >= 0 && v >= 0 && u < iw && v < ih, j = (y * pw + x) * 4;
        if (!inside && o.border === 'white') { // white border / no bleed colour
          const inCut = u >= -off * dpi && v >= -off * dpi && u < iw + off * dpi && v < ih + off * dpi;
          if (inCut) { op[j] = op[j + 1] = op[j + 2] = op[j + 3] = 255; } else anyAlpha = true;
          continue;
        }
        const sx = Math.min(iw - 1, Math.max(0, Math.floor(u))), sy = Math.min(ih - 1, Math.max(0, Math.floor(v))), s = (sy * iw + sx) * 4;
        op[j] = ip[s]; op[j + 1] = ip[s + 1]; op[j + 2] = ip[s + 2]; op[j + 3] = ip[s + 3]; if (ip[s + 3] < 255) anyAlpha = true;
      }
      g.putImageData(od, 0, 0);
      return { cutW, cutH, loops, print: { canvas: c, x: -b, y: -b, w: pw / dpi, h: ph / dpi, hasAlpha: anyAlpha }, info: { components: 1 } };
    }
    // contour
    const pad = Math.ceil((off + b) * dpi) + 4, W = iw + 2 * pad, H = ih + 2 * pad, N = W * H, thr = o.alphaThreshold || 128;
    const art = new Uint8Array(N);
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) if (ip[(y * iw + x) * 4 + 3] >= thr) art[(y + pad) * W + x + pad] = 1;
    let anyArt = false; for (let i = 0; i < N; i++) if (art[i]) { anyArt = true; break; }
    if (!anyArt) return processItem(src, Object.assign({}, o, { shape: 'rect' }));
    const E = edt(art, W, H, true), offPx = off * dpi, off2 = offPx * offPx;
    let cut = new Uint8Array(N); for (let i = 0; i < N; i++) cut[i] = E.d2[i] <= off2 ? 1 : 0;
    cut = fillHoles(cut, W, H);
    const dc = dropSmallComponents(cut, W, H, o.minIslandFrac == null ? 0.01 : o.minIslandFrac, Math.max(9, (0.03 * dpi) ** 2));
    cut = dc.mask;
    let loopsPx = marchingSquares(cut, W, H).filter(l => l.closed).map(l => l.pts);
    loopsPx = loopsPx.map(p => simplifyClosed(p, o.simplifyPx || 0.6)).filter(p => p.length >= 3 && Math.abs(signedArea(p)) > 4);
    loopsPx = loopsPx.map(p => signedArea(p) < 0 ? p.slice().reverse() : p);
    let x0 = INF, y0 = INF, x1 = -INF, y1 = -INF;
    for (const p of loopsPx) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const loops = loopsPx.map(p => polyLoop(p.map(([x, y]) => [(x - x0) / dpi, (y - y0) / dpi])));
    // print region: within bleed of the kept cut region
    const Ec = edt(cut, W, H, false), b2 = (b * dpi) * (b * dpi);
    const c = makeCanvas(W, H), g = c.getContext('2d'), od = g.createImageData(W, H), op = od.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (Ec.d2[i] > b2) continue; const j = i * 4;
      const ax = x - pad, ay = y - pad, inImg = ax >= 0 && ay >= 0 && ax < iw && ay < ih, s = inImg ? (ay * iw + ax) * 4 : -1;
      const a = s >= 0 ? ip[s + 3] / 255 : 0;
      // extend mode: colour the bleed band (outside the cut) and the offset band; interior holes stay paper-white
      const extendHere = !cut[i] || E.d2[i] <= Math.max(off2, 2);
      let br = 255, bg = 255, bb = 255, ba = o.border === 'white' ? (cut[i] ? 1 : 0) : (extendHere ? 1 : 0);
      if (o.border !== 'white') { const n = E.near[i]; if (n >= 0) { const nx = n % W - pad, ny = ((n / W) | 0) - pad, t = (ny * iw + nx) * 4; br = ip[t]; bg = ip[t + 1]; bb = ip[t + 2]; } }
      if (s >= 0 && a >= 1) { op[j] = ip[s]; op[j + 1] = ip[s + 1]; op[j + 2] = ip[s + 2]; op[j + 3] = 255; continue; }
      const outA = a + ba * (1 - a);
      if (outA <= 0) continue;
      const mix = (fc, bc) => Math.round((fc * a + bc * ba * (1 - a)) / outA);
      op[j] = s >= 0 ? mix(ip[s], br) : br; op[j + 1] = s >= 0 ? mix(ip[s + 1], bg) : bg; op[j + 2] = s >= 0 ? mix(ip[s + 2], bb) : bb; op[j + 3] = Math.round(outA * 255);
    }
    // crop the print canvas to its inked extent (transparent padding removed)
    let cx0 = W, cy0 = H, cx1 = -1, cy1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (op[(y * W + x) * 4 + 3]) { if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
    if (cx1 < 0) { cx0 = 0; cy0 = 0; cx1 = W - 1; cy1 = H - 1; }
    const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1, c2 = makeCanvas(cw, ch);
    g.putImageData(od, 0, 0); c2.getContext('2d').drawImage(c, cx0, cy0, cw, ch, 0, 0, cw, ch);
    return { cutW: (x1 - x0) / dpi, cutH: (y1 - y0) / dpi, loops,
      print: { canvas: c2, x: (cx0 - x0) / dpi, y: (cy0 - y0) / dpi, w: cw / dpi, h: ch / dpi, hasAlpha: true }, info: { components: dc.components } };
  }

  /** rotate a processed item 90 degrees clockwise */
  function rotateProcessed(p) {
    const H = p.cutH; // (x,y) -> (H - y, x)
    const loops = p.loops.map(l => mapLoop(l, (x, y) => [H - y, x]));
    const src = p.print.canvas, c = makeCanvas(src.height, src.width), g = c.getContext('2d');
    g.translate(src.height, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
    const pr = p.print; // print rect corners: x..x+w, y..y+h -> new x = H - (y+h), new y = x
    return { cutW: p.cutH, cutH: p.cutW, loops, print: { canvas: c, x: H - (pr.y + pr.h), y: pr.x, w: pr.h, h: pr.w, hasAlpha: pr.hasAlpha }, info: p.info, rotated: true };
  }

  /** bake a projective warp into a processed piece. f maps the piece's cut-box inches to warped inches and finv maps back.
      The print raster is resampled at dpi through finv (bilinear, premultiplied alpha) and the cut loops go through f, so print and cut stay aligned.
      The result is re-based so its cut bbox starts at 0,0 (cutW/cutH = the warped bbox). */
  function warpProcessed(p, f, finv, dpi) {
    const flat = p.loops.map(l => { const pts = []; let cx = 0, cy = 0;
      for (const s of l) { if (s[0] === 'M' || s[0] === 'L') { cx = s[1]; cy = s[2]; pts.push([cx, cy]); }
        else if (s[0] === 'C') { for (let k = 1; k <= 16; k++) { const t = k / 16, u = 1 - t; pts.push([u * u * u * cx + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5], u * u * u * cy + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6]]); } cx = s[5]; cy = s[6]; } }
      if (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-12 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-12) pts.pop();
      return pts; });
    const mp = flat.map(P => P.map(([x, y]) => f(x, y)));
    let x0 = INF, y0 = INF, x1 = -INF, y1 = -INF;
    for (const P of mp) for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const loops = mp.map(P => polyLoop(P.map(([x, y]) => [x - x0, y - y0])));
    const pr = p.print, cs = [[pr.x, pr.y], [pr.x + pr.w, pr.y], [pr.x + pr.w, pr.y + pr.h], [pr.x, pr.y + pr.h]].map(([x, y]) => f(x, y));
    const X0 = Math.min(...cs.map(c => c[0])), Y0 = Math.min(...cs.map(c => c[1])), X1 = Math.max(...cs.map(c => c[0])), Y1 = Math.max(...cs.map(c => c[1]));
    const W = Math.max(1, Math.ceil((X1 - X0) * dpi)), H = Math.max(1, Math.ceil((Y1 - Y0) * dpi));
    const src = pr.canvas, sw = src.width, sh = src.height, sd = src.getContext('2d').getImageData(0, 0, sw, sh).data, kx = sw / pr.w, ky = sh / pr.h;
    const c = makeCanvas(W, H), g = c.getContext('2d'), od = g.createImageData(W, H), o = od.data;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
      const b = finv(X0 + (u + 0.5) / dpi, Y0 + (v + 0.5) / dpi), fx = (b[0] - pr.x) * kx - 0.5, fy = (b[1] - pr.y) * ky - 0.5;
      if (!(fx > -1 && fy > -1 && fx < sw && fy < sh)) continue;
      const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy; let r = 0, gg = 0, bb = 0, a = 0;
      for (let q = 0; q < 4; q++) { const X = ix + (q & 1), Y = iy + (q >> 1); if (X < 0 || Y < 0 || X >= sw || Y >= sh) continue;
        const wt = ((q & 1) ? ax : 1 - ax) * ((q >> 1) ? ay : 1 - ay), j = (Y * sw + X) * 4, al = sd[j + 3] * wt; r += sd[j] * al; gg += sd[j + 1] * al; bb += sd[j + 2] * al; a += al; }
      if (a <= 0.5) continue; const j = (v * W + u) * 4; o[j] = r / a; o[j + 1] = gg / a; o[j + 2] = bb / a; o[j + 3] = a; }
    g.putImageData(od, 0, 0);
    return { cutW: x1 - x0, cutH: y1 - y0, loops, print: { canvas: c, x: X0 - x0, y: Y0 - y0, w: W / dpi, h: H / dpi, hasAlpha: true }, info: p.info, warped: true };
  }

  // ---------- MaxRects bin packing (best short side fit), multi-sheet ----------
  function packAll(rects, binW, binH, allowRotateGlobal) {
    // try several orderings x placement rules, keep the result with fewest sheets / unplaced, then densest early sheets
    const orders = [(r) => -(r.w * r.h), (r) => -Math.max(r.w, r.h), (r) => -r.h, (r) => -r.w, (r) => -(r.w + r.h)];
    let best = null;
    for (const ok of orders) for (const rule of ['bssf', 'baf', 'bl']) {
      const res = packOnce(rects, binW, binH, allowRotateGlobal, ok, rule);
      const fill = res.sheets.map(sh => sh.reduce((t, q) => t + q.w * q.h, 0));
      const score = [res.unplaced.length, res.sheets.length, -(fill[0] || 0), -(fill[1] || 0)];
      const better = () => { for (let i = 0; i < score.length; i++) if (Math.abs(score[i] - best.score[i]) > 1e-9) return score[i] < best.score[i]; return false; };
      if (!best || better()) best = { res, score };
    }
    return best.res;
  }
  function packOnce(rects, binW, binH, allowRotateGlobal, orderKey, rule) {
    // rects: [{id, w, h, canRotate}] ; returns {sheets:[[{id,x,y,w,h,rot}]], unplaced:[id]}
    const order = rects.map((r, i) => i).sort((a, b) => (orderKey(rects[a]) - orderKey(rects[b])) || (rects[b].w * rects[b].h - rects[a].w * rects[a].h) || a - b);
    const bins = [], sheets = [], unplaced = [];
    const newBin = () => { bins.push([{ x: 0, y: 0, w: binW, h: binH }]); sheets.push([]); return bins.length - 1; };
    const EPS = 1e-9;
    function find(free, w, h, rot) { let best = null;
      for (const f of free) for (const [ww, hh, rr] of rot ? [[w, h, false], [h, w, true]] : [[w, h, false]]) {
        if (ww <= f.w + EPS && hh <= f.h + EPS) {
          let ss = Math.min(f.w - ww, f.h - hh), ls = Math.max(f.w - ww, f.h - hh);
          if (rule === 'baf') { ls = ss; ss = f.w * f.h - ww * hh; } else if (rule === 'bl') { ss = f.y + hh; ls = f.x; }
          if (!best || ss < best.ss - EPS || (Math.abs(ss - best.ss) < EPS && (ls < best.ls - EPS || (Math.abs(ls - best.ls) < EPS && (f.y < best.y - EPS || (Math.abs(f.y - best.y) < EPS && f.x < best.x)))))) best = { x: f.x, y: f.y, w: ww, h: hh, rot: rr, ss, ls }; } }
      return best; }
    function place(free, r) {
      const out = [];
      for (const f of free) {
        if (r.x >= f.x + f.w - EPS || r.x + r.w <= f.x + EPS || r.y >= f.y + f.h - EPS || r.y + r.h <= f.y + EPS) { out.push(f); continue; }
        if (r.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
        if (r.x + r.w < f.x + f.w - EPS) out.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
        if (r.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
        if (r.y + r.h < f.y + f.h - EPS) out.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
      }
      return out.filter((a, i) => !out.some((b, j) => j !== i && a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS && (j < i || !(Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.w - b.w) < EPS && Math.abs(a.h - b.h) < EPS))));
    }
    for (const i of order) {
      const r = rects[i], rot = allowRotateGlobal && r.canRotate;
      if (!find([{ x: 0, y: 0, w: binW, h: binH }], r.w, r.h, rot)) { unplaced.push(r.id); continue; }
      let done = false;
      for (let bi = 0; bi < bins.length && !done; bi++) { const p = find(bins[bi], r.w, r.h, rot); if (p) { bins[bi] = place(bins[bi], p); sheets[bi].push({ id: r.id, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot }); done = true; } }
      if (!done) { const bi = newBin(), p = find(bins[bi], r.w, r.h, rot); bins[bi] = place(bins[bi], p); sheets[bi].push({ id: r.id, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot }); }
    }
    return { sheets, unplaced };
  }

  // ---------- calibration correction ----------
  // Stored correction (v2) maps the INTENDED sheet position p (where the ink is) to the position f written in the cut file:
  //   f = c + A (p - c) + t      (c = sheet centre, A = 2x2 [a11,a12,a21,a22], t = [tx,ty] inches)
  // Legacy v1 {ax,ay,bx,by}: f = p - (a + b (p - c))  ->  A = diag(1-bx, 1-by), t = (-ax, -ay)
  function normCorr(c) {
    if (c && c.v === 2) return c;
    c = c || {}; const ax = c.ax || 0, ay = c.ay || 0, bx = c.bx || 0, by = c.by || 0;
    return { v: 2, a11: 1 - bx, a12: 0, a21: 0, a22: 1 - by, tx: -ax, ty: -ay };
  }
  const IDENTITY = { v: 2, a11: 1, a12: 0, a21: 0, a22: 1, tx: 0, ty: 0 };
  function makeCorrector(corr, cx, cy) {
    const k = normCorr(corr);
    return (x, y) => { const dx = x - cx, dy = y - cy; return [cx + k.a11 * dx + k.a12 * dy + k.tx, cy + k.a21 * dx + k.a22 * dy + k.ty]; };
  }
  function solve(M, b) { // Gaussian elimination with partial pivoting; returns null if singular
    const n = b.length, a = M.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
      if (Math.abs(a[p][i]) < 1e-12) return null; [a[i], a[p]] = [a[p], a[i]];
      for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i] / a[i][i]; for (let k = i; k <= n; k++) a[r][k] -= f * a[i][k]; }
    }
    return a.map((r, i) => r[n] / r[i]);
  }
  /** Fit how the machine maps cut-file positions f to where it actually cuts, from calibration readings.
      samples: [{id, fx, fy (file position, in), px, py (printed position, in), rx, ry (reading = cut - print, in; NaN if blank)}]
      model: cut = c + S (f - c) + u,  S = [[sx, -th], [th, sy]] (per-axis scale + small rotation), u = offset at the centre
      Rotation is fitted only when >= 3 targets have both readings; a scale only when that axis has >= 2 distinct positions. */
  function fitMachine(samples, cx, cy) {
    const X = samples.filter(q => isFinite(q.rx)), Y = samples.filter(q => isFinite(q.ry)), both = samples.filter(q => isFinite(q.rx) && isFinite(q.ry));
    const distinct = (arr, k) => new Set(arr.map(q => q[k].toFixed(3))).size;
    const useSx = distinct(X, 'fx') >= 2, useSy = distinct(Y, 'fy') >= 2, useTh = both.length >= 3 && useSx && useSy;
    const names = ['ux', 'uy']; if (useSx) names.push('sx'); if (useSy) names.push('sy'); if (useTh) names.push('th');
    const rows = [], rhs = [];
    // X rows: cutx - cx = sx*dfx - th*dfy + ux   (if !useSx, sx = 1 is moved to rhs)
    for (const q of X) { const dfx = q.fx - cx, dfy = q.fy - cy, cut = q.px + q.rx - cx;
      rows.push(names.map(n => n === 'ux' ? 1 : n === 'sx' ? dfx : n === 'th' ? -dfy : 0)); rhs.push(cut - (useSx ? 0 : dfx)); }
    for (const q of Y) { const dfx = q.fx - cx, dfy = q.fy - cy, cut = q.py + q.ry - cy;
      rows.push(names.map(n => n === 'uy' ? 1 : n === 'sy' ? dfy : n === 'th' ? dfx : 0)); rhs.push(cut - (useSy ? 0 : dfy)); }
    const n = names.length, N = Array.from({ length: n }, () => new Array(n).fill(0)), B = new Array(n).fill(0);
    rows.forEach((r, i) => { for (let a = 0; a < n; a++) { B[a] += r[a] * rhs[i]; for (let b = 0; b < n; b++) N[a][b] += r[a] * r[b]; } });
    // unknowns with no data (e.g. no X readings) are pinned to identity
    for (let a = 0; a < n; a++) if (N[a][a] === 0) { N[a][a] = 1; B[a] = 0; }
    const sol = solve(N, B) || new Array(n).fill(0), v = {}; names.forEach((k, i) => v[k] = sol[i]);
    const m = { sx: useSx ? v.sx : 1, sy: useSy ? v.sy : 1, th: useTh ? v.th : 0, ux: v.ux || 0, uy: v.uy || 0, useSx, useSy, useTh, nX: X.length, nY: Y.length };
    const pred = (fx, fy) => { const dx = fx - cx, dy = fy - cy; return [cx + m.sx * dx - m.th * dy + m.ux, cy + m.th * dx + m.sy * dy + m.uy]; };
    m.residuals = samples.map(q => { const [qx, qy] = pred(q.fx, q.fy); return { id: q.id, x: isFinite(q.rx) ? (q.px + q.rx) - qx : NaN, y: isFinite(q.ry) ? (q.py + q.ry) - qy : NaN }; });
    m.predict = pred;
    return m;
  }
  /** correction (v2) that makes the fitted machine cut exactly on the print: f = c + S^-1 (p - c - u) */
  function correctionFromMachine(m) {
    const det = m.sx * m.sy + m.th * m.th, i11 = m.sy / det, i12 = m.th / det, i21 = -m.th / det, i22 = m.sx / det;
    return { v: 2, a11: i11, a12: i12, a21: i21, a22: i22, tx: -(i11 * m.ux + i12 * m.uy), ty: -(i21 * m.ux + i22 * m.uy) };
  }
  /** describe a v2 correction as the machine error it cancels */
  function describeCorr(k) {
    k = normCorr(k); const det = k.a11 * k.a22 - k.a12 * k.a21; // machine S = A^-1, u = -S t
    const s11 = k.a22 / det, s12 = -k.a12 / det, s21 = -k.a21 / det, s22 = k.a11 / det;
    return { sx: s11, sy: s22, th: (s21 - s12) / 2, ux: -(s11 * k.tx + s12 * k.ty), uy: -(s21 * k.tx + s22 * k.ty) };
  }
  function fitLinear(samples, c) { // kept for compatibility
    const s = samples.filter(q => isFinite(q.r)); if (!s.length) return { a: 0, b: 0, n: 0 };
    const mx = s.reduce((t, q) => t + q.pos - c, 0) / s.length, mr = s.reduce((t, q) => t + q.r, 0) / s.length;
    let sxx = 0, sxr = 0; for (const q of s) { sxx += (q.pos - c - mx) ** 2; sxr += (q.pos - c - mx) * (q.r - mr); }
    const b = sxx > 1e-6 ? sxr / sxx : 0; return { a: mr - b * mx, b, n: s.length };
  }

  // ---------- calibration model v3: printer model + print compensation ----------
  // design position p (where the art should be, true size, sheet inches)
  // print file position  y = Pc(p) = c + E (p - c)          E = diag(ex, ey)  (print compensation, 1 = off)
  // Q(y): where the printer actually puts file position y, as seen by the cutter (affine, fitted from readings)
  // cut file position    f = Q(Pc(p))  -> the cut lands on the ink.  When E = 1/scale(Q), the print is true size and
  // the cut correction is only offset + rotation.   Readings r = cut - ink, so Q(y_i) = f_i - r_i (absolute fit, never stacked).
  const qFromParams = (m) => ({ v: 2, a11: m.sx, a12: -m.th, a21: m.th, a22: m.sy, tx: m.ux, ty: m.uy });
  function calDefault() { return { v: 3, Q: Object.assign({}, IDENTITY), ex: 1, ey: 1, mode: null, pass: 0, tol: 0.5 / 25.4, status: 'new', issued: {}, history: [] }; }
  function calFromLegacy(old) { const c = calDefault(); if (old) { c.Q = normCorr(old); c.status = 'legacy'; } return c; }
  function calCutCorr(cal) { const q = normCorr(cal.Q), ex = cal.ex || 1, ey = cal.ey || 1;
    return { v: 2, a11: q.a11 * ex, a12: q.a12 * ey, a21: q.a21 * ex, a22: q.a22 * ey, tx: q.tx, ty: q.ty }; }
  function printMap(ex, ey, cx, cy) { return (x, y) => [cx + (ex || 1) * (x - cx), cy + (ey || 1) * (y - cy)]; }
  function calCode(Q, ex, ey, layout) { const q = normCorr(Q), str = [q.a11, q.a12, q.a21, q.a22, q.tx, q.ty, ex || 1, ey || 1].map(v => v.toFixed(6)).join('|') + ((layout || 1) >= 2 ? '|L' + layout : '');
    let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < 4; i++) { o += A[h % A.length]; h = Math.floor(h / A.length); } return o; }
  /** samples: [{id, px,py (design target), yx,yy (file print pos), fx,fy (file cut pos), rx,ry (reading in, NaN if blank)}] */
  function calFit(samples, cx, cy) {
    const m = fitMachine(samples.map(q => ({ id: q.id, fx: q.yx, fy: q.yy, px: q.fx, py: q.fy, rx: isFinite(q.rx) ? -q.rx : NaN, ry: isFinite(q.ry) ? -q.ry : NaN })), cx, cy);
    // misfit in reading terms: actual reading - reading predicted by the fitted model
    const misfit = m.residuals.map(r => ({ id: r.id, x: isFinite(r.x) ? -r.x : NaN, y: isFinite(r.y) ? -r.y : NaN }));
    // leave-one-out check: predict each target from the other four (much more sensitive to a single mis-read)
    const loo = samples.map((q, i) => {
      if (!isFinite(q.rx) && !isFinite(q.ry)) return { id: q.id, x: NaN, y: NaN };
      const rest = samples.filter((_, j) => j !== i); if (rest.filter(r => isFinite(r.rx) || isFinite(r.ry)).length < 3) return { id: q.id, x: NaN, y: NaN };
      const mm = fitMachine(rest.map(r => ({ id: r.id, fx: r.yx, fy: r.yy, px: r.fx, py: r.fy, rx: isFinite(r.rx) ? -r.rx : NaN, ry: isFinite(r.ry) ? -r.ry : NaN })), cx, cy);
      const [gx, gy] = mm.predict(q.yx, q.yy); // predicted ink position in cutter frame -> predicted reading = f - g
      return { id: q.id, x: isFinite(q.rx) ? q.rx - (q.fx - gx) : NaN, y: isFinite(q.ry) ? q.ry - (q.fy - gy) : NaN };
    });
    return { Q: qFromParams(m), q: { qx: m.sx, qy: m.sy, th: m.th, ux: m.ux, uy: m.uy }, misfit, loo, nX: m.nX, nY: m.nY, useTh: m.useTh, useSx: m.useSx, useSy: m.useSy };
  }
  /** describe the raw readings of one pass as offset + scale + rotation (relative to the design positions) */
  function readingPattern(samples, cx, cy) {
    const m = fitMachine(samples.map(q => ({ id: q.id, fx: q.px, fy: q.py, px: q.px, py: q.py, rx: q.rx, ry: q.ry })), cx, cy);
    return { ux: m.ux, uy: m.uy, dsx: m.sx - 1, dsy: m.sy - 1, th: m.th, misfit: m.residuals };
  }
  /** look for one target whose readings were probably typed swapped (X<->Y) or with a flipped sign: the fit collapses if corrected */
  function suggestFixes(samples, cx, cy) {
    const mx = (f) => f.misfit.reduce((m, r) => Math.max(m, isFinite(r.x) ? Math.abs(r.x) : 0, isFinite(r.y) ? Math.abs(r.y) : 0), 0);
    const base = mx(calFit(samples, cx, cy)); if (!(base > 0.6 / 25.4)) return null;
    let best = null;
    samples.forEach((q, i) => { if (!isFinite(q.rx) || !isFinite(q.ry)) return;
      for (const [kind, rx, ry] of [['swap', q.ry, q.rx], ['flipX', -q.rx, q.ry], ['flipY', q.rx, -q.ry]]) { if (kind !== 'swap' && Math.abs(q[kind === 'flipX' ? 'rx' : 'ry']) < 0.5 / 25.4) continue;
        const s2 = samples.slice(); s2[i] = Object.assign({}, q, { rx, ry }); const m = mx(calFit(s2, cx, cy));
        if (m < 0.5 / 25.4 && m < 0.35 * base && (!best || m < best.after)) best = { id: q.id, kind, before: base, after: m, x: rx, y: ry }; } });
    return best; }
  function rulerShrink(measured, expected, exCurrent) { // printed corner-mark distance -> printer shrink + needed print enlargement
    const scale = measured / (expected * (exCurrent || 1)); return { scale, shrink: 1 - scale, comp: 1 / scale - 1 }; }
  /** verdict for one calibration pass.  cal = state the sheet was printed/cut with (ex,ey,mode); fit = calFit(...); pat = readingPattern(...) */
  function judgePass(o) {
    const { samples, fit, pat, ex, ey, mode, tol, spanX, spanY } = o, MMi = 25.4;
    const vals = []; for (const q of samples) { if (isFinite(q.rx)) vals.push(Math.abs(q.rx)); if (isFinite(q.ry)) vals.push(Math.abs(q.ry)); }
    const worst = vals.length ? Math.max(...vals) : NaN, n = vals.length;
    // single-target outlier (unchanged rule: misfit > 1 mm, or a leave-one-out error > 1.6 mm pinpoints the worst one). ignoreBad = user chose "Use anyway".
    const looTol = (o.looTolMm || 1.6) / MMi, fitTol = 1 / MMi, ax = (r) => Math.max(isFinite(r.x) ? Math.abs(r.x) : 0, isFinite(r.y) ? Math.abs(r.y) : 0);
    let bad = fit.misfit.filter(r => Math.abs(r.x) > fitTol || Math.abs(r.y) > fitTol).map(r => r.id);
    const looBad = (fit.loo || []).map(r => ({ id: r.id, e: ax(r) })).filter(r => r.e > looTol).sort((p, q) => q.e - p.e);
    if (looBad.length) bad = [looBad[0].id];
    if (o.ignoreBad) bad = [];
    const misMax = fit.misfit.reduce((m, r) => Math.max(m, ax(r)), 0);
    const printScaleX = fit.q.qx * ex, printScaleY = fit.q.qy * ey; // physical print size relative to design (1 = true size)
    const shrinkX = 1 - printScaleX, shrinkY = 1 - printScaleY;
    const compX = (ex / printScaleX) - 1, compY = (ey / printScaleY) - 1; // total enlargement that would give true size
    const trueSizeOff = Math.max(Math.abs(shrinkX), Math.abs(shrinkY));
    const v = { worst, n, bad, shrinkX, shrinkY, compX, compY, trueSizeOff, printScaleX, printScaleY, misMax, noisy: misMax > 0.6 / MMi, kinds: [], status: 'retry' };
    if (n < 4) { v.status = 'incomplete'; return v; }
    if (bad.length) { v.status = 'bad-reading'; v.kinds.push('bad'); return v; }
    // safeguard: the compensation changed since the previous pass but the size on paper did not follow it
    // (a different/older PDF was printed, the wrong sheet code was picked, or something rescaled the content)
    const pv = o.prev, why = [];
    if (pv && isFinite(pv.psx) && isFinite(pv.ex)) {
      const chk = (exNow, exPrev, psNow, psPrev, ax) => { const want = exNow / exPrev - 1, got = psNow / psPrev - 1;
        if (Math.abs(want) > 0.01 && Math.abs(got) < 0.35 * Math.abs(want)) why.push({ ax, want, got }); };
      chk(ex, pv.ex, printScaleX, pv.psx, 'X'); chk(ey, pv.ey, printScaleY, pv.psy, 'Y'); }
    const ru = o.ruler || {};
    for (const [ax, sc, e] of [['X', ru.x, ex], ['Y', ru.y, ey]]) // ruler on paper vs true size, on a sheet that claims compensation
      if (isFinite(sc) && e > 1.01 && (1 - sc) > 0.65 * (1 - 1 / e) && !why.some(w => w.ax === ax)) why.push({ ax, ruler: sc, want: e - 1 });
    if (why.length) { v.status = 'comp-not-applied'; v.compWhy = why; return v; }
    // components of the remaining error, in mm at the sheet edge
    const offMm = Math.hypot(pat.ux, pat.uy), scaleMm = Math.max(Math.abs(pat.dsx) * spanX / 2, Math.abs(pat.dsy) * spanY / 2), rotMm = Math.abs(pat.th) * Math.max(spanX, spanY) / 2;
    v.components = { offMm: offMm * MMi, scaleMm: scaleMm * MMi, rotMm: rotMm * MMi };
    const printerShrinks = trueSizeOff > 0.005; // > 0.5 %
    if (worst <= tol) {
      v.status = 'calibrated';
      if (mode === 'compensate' && trueSizeOff > 0.003) v.adjustComp = true; // cuts match, but print not quite true size (> 0.3 %)
      if (!mode && printerShrinks) v.offerChoice = true;
      return v;
    }
    if (!mode && printerShrinks) { v.status = 'needs-choice'; return v; }
    const big = Math.max(offMm, scaleMm, rotMm);
    if (offMm === big) v.kinds.push('offset'); if (scaleMm === big) v.kinds.push('scale'); if (rotMm === big) v.kinds.push('rotation');
    if (mode === 'compensate' && trueSizeOff > 0.003) v.adjustComp = true;
    return v;
  }

  // ---------- SVG cut file ----------
  /** sheet {w,h}, inset (DS margin, normally 0.25), anchor:'dots'|'frame'|'none', cutLoops: loops in SHEET inches (already corrected)
      The SVG canvas is exactly the anchor box (sheet minus inset on every side), so whether Design Space trims to content or keeps the canvas, the result is identical. */
  function buildCutSVG(sheet, inset, anchor, cutLoops, meta) {
    const bw = sheet.w - 2 * inset, bh = sheet.h - 2 * inset, s = PT, dot = 0.04;
    const ds = [];
    if (anchor === 'dots' || anchor === 'none') {
      if (anchor === 'dots') for (const [x, y] of [[inset, inset], [sheet.w - inset - dot, inset], [inset, sheet.h - inset - dot], [sheet.w - inset - dot, sheet.h - inset - dot]])
        ds.push(loopToD(roundedRectLoop(x, y, dot, dot, 0), s, -inset, -inset, 3));
    }
    for (const l of cutLoops) ds.push(loopToD(l, s, -inset, -inset, 3));
    const fmt = (v) => (+v.toFixed(4)).toString();
    let out = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${meta || ''} -->\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${fmt(bw)}in" height="${fmt(bh)}in" viewBox="0 0 ${fmt(bw * s)} ${fmt(bh * s)}">\n`;
    if (anchor === 'frame') out += `  <path id="frame" fill="none" stroke="#000000" stroke-width="0.5" d="${loopToD(roundedRectLoop(inset, inset, bw, bh, 0), s, -inset, -inset, 3)}"/>\n`;
    out += `  <path id="cuts" fill="#000000" fill-rule="nonzero" d="${ds.join('')}"/>\n</svg>\n`;
    return out;
  }

  global.CSTCore = { PT, edt, fillHoles, dropSmallComponents, marchingSquares, signedArea, simplifyClosed, rdp, polyLoop, roundedRectLoop, mapLoop, loopBBox, loopToD,
    processItem, rotateProcessed, warpProcessed, packAll, makeCorrector, fitLinear, normCorr, fitMachine, correctionFromMachine, describeCorr, IDENTITY, calDefault, calFromLegacy, calCutCorr, printMap, calCode, calFit, readingPattern, rulerShrink, judgePass, suggestFixes, buildCutSVG, makeCanvas };
})(typeof window !== 'undefined' ? window : globalThis);
