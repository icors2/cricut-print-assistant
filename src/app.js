/* Cricut Print Assistant - UI */
(function () {
  'use strict';
  const C = window.CSTCore, PT = 72, MM = 25.4;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const SHEETS = {
    letter: { name: 'US Letter 8.5 × 11 in', w: 8.5, h: 11 },
    legal: { name: 'US Legal 8.5 × 14 in', w: 8.5, h: 14 },
    a4: { name: 'A4 210 × 297 mm', w: 210 / MM, h: 297 / MM },
    sq12: { name: '12 × 12 in cardstock', w: 12, h: 12 },
    custom: { name: 'Custom', w: 8.5, h: 11 },
  };
  const DEF = { sheet: 'letter', landscape: false, customW: 8.5, customH: 11, unit: 'in', margin: 0.30, spacing: 0.125, bleed: 1.3 / MM, dpi: 300,
    rotate: true, anchor: 'dots', marks: true, applyCorr: true, inset: 0.25, printerMargin: 0.125 };
  // ---------- persistence ----------
  // Browser storage is the main store. Files opened from disk (file://) can get storage that some browsers drop or keep per file path,
  // so calibration + settings are also mirrored into window.name (survives a refresh in the same tab) and can be exported/imported as JSON.
  // the untouched page source (captured before anything changes the DOM) and a calibration built into this copy of the file, if any
  const PRISTINE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  let EMBEDDED = null; try { const el = document.getElementById('cstEmbedded'); EMBEDDED = el ? JSON.parse(el.textContent || 'null') : null; } catch (e) { EMBEDDED = null; }
  const STORE = (() => { let ls = null, ok = false;
    try { ls = window.localStorage; const k = 'cst.__probe'; ls.setItem(k, '1'); ok = ls.getItem(k) === '1'; ls.removeItem(k); } catch (e) { ok = false; }
    const mem = {}, mirrored = (k) => /^cst\.(cal|corr|draft)\./.test(k) || k === 'cst.settings';
    // same-tab backup: sessionStorage, else window.name (both survive a refresh of this tab)
    let mirror = {}; try { const t = sessionStorage.getItem('cst.tabBackup'); if (t) mirror = JSON.parse(t) || {}; } catch (e) { /* ignore */ }
    try { if (!Object.keys(mirror).length && typeof window.name === 'string' && window.name.slice(0, 4) === 'cst:') mirror = JSON.parse(window.name.slice(4)) || {}; } catch (e) { /* ignore */ }
    const writeMirror = () => { const j = JSON.stringify(mirror); try { sessionStorage.setItem('cst.tabBackup', j); } catch (e) { /* ignore */ } try { window.name = 'cst:' + j; } catch (e) { /* ignore */ } };
    const raw = (k) => { try { return ok ? ls.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return k in mem ? mem[k] : null; } };
    const put = (k, v) => { try { if (ok) ls.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } };
    let restored = 0; for (const k in mirror) if (raw(k) == null) { put(k, mirror[k]); if (/^cst\.cal\./.test(k)) restored++; }
    try { if (ok) { for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (mirrored(k)) mirror[k] = ls.getItem(k); } writeMirror(); } } catch (e) { /* ignore */ } // refresh the tab backup at start
    return { ok, restored, get: (k) => { const v = raw(k); return v != null ? v : (k in mirror ? mirror[k] : null); },
      set: (k, v) => { put(k, v); if (mirrored(k)) { mirror[k] = v; writeMirror(); } },
      del: (k) => { try { if (ok) ls.removeItem(k); } catch (e) { /* ignore */ } delete mem[k]; if (k in mirror) { delete mirror[k]; writeMirror(); } },
      keys: () => { const out = new Set(Object.keys(mirror).concat(Object.keys(mem))); try { if (ok) for (let i = 0; i < ls.length; i++) out.add(ls.key(i)); } catch (e) { /* ignore */ } return [...out]; } };
  })();
  const S = Object.assign({}, DEF, JSON.parse(STORE.get('cst.settings') || '{}'));
  let items = [], nextId = 1, layout = null, curSheet = 0, busy = false, dirtyTimer = null;
  const cache = new Map();

  // ---------- units ----------
  const toU = (inch) => S.unit === 'mm' ? +(inch * MM).toFixed(2) : +inch.toFixed(4);
  const fromU = (v) => S.unit === 'mm' ? v / MM : v;
  const fmtShort = (inch) => S.unit === 'mm' ? (inch * MM).toFixed(0) + ' mm' : (+inch.toFixed(2)) + ' in';
  const fmtLen = (inch) => S.unit === 'mm' ? (inch * MM).toFixed(1) + ' mm' : inch.toFixed(3) + ' in';
  function sheetDims() {
    const p = SHEETS[S.sheet] || SHEETS.letter; let w = S.sheet === 'custom' ? S.customW : p.w, h = S.sheet === 'custom' ? S.customH : p.h;
    if (S.landscape) [w, h] = [h, w];
    return { w, h, key: S.sheet + (S.landscape ? '-L' : '-P') + (S.sheet === 'custom' ? `-${w.toFixed(2)}x${h.toFixed(2)}` : '') };
  }
  function matInfo(sh) {
    const bw = sh.w - 2 * S.inset, bh = sh.h - 2 * S.inset;
    if (sh.w > 12.001) return { ok: false, msg: 'Sheet is wider than a Cricut mat (12 in). Use portrait orientation.' };
    if (bw > 11.5 + 1e-6) return { ok: false, msg: 'Cut area is wider than 11.5 in (Cricut max).' };
    if (sh.h <= 12.001 && bh <= 11.5 + 1e-6) return { ok: true, mat: '12 × 12 in', bw, bh };
    if (sh.h <= 24.001 && bh <= 23.5 + 1e-6) return { ok: true, mat: '12 × 24 in', bw, bh };
    return { ok: false, msg: 'Sheet too tall for a 12 × 24 in mat.' };
  }
  const corrKey = () => 'cst.corr.' + sheetDims().key, calKey = () => 'cst.cal.' + sheetDims().key;
  // calibration state v3 (printer model Q + print compensation + wizard state). Older saved corrections
  // ('cst.corr.*', legacy {ax,ay,bx,by} or v2 matrix) are migrated on first read: they become Q with no compensation.
  function getCal() { const raw = STORE.get(calKey()); if (raw) { const c = JSON.parse(raw); return Object.assign(C.calDefault(), c); }
    return C.calFromLegacy(JSON.parse(STORE.get(corrKey()) || 'null')); }
  function saveCal(c) { c.savedAt = Date.now(); STORE.set(calKey(), JSON.stringify(c)); STORE.set(corrKey(), JSON.stringify(C.calCutCorr(c))); }
  const draftKey = () => 'cst.draft.' + sheetDims().key;
  function saveDraft() { if (!$('#caltable input')) return; STORE.set(draftKey(), JSON.stringify({ t: Date.now(), code: $('#calCode').value, readings: readCalInputs(), rulerX: $('#rulerX').value, rulerY: $('#rulerY').value })); }
  function restoreDraft() { let d = null; try { d = JSON.parse(STORE.get(draftKey()) || 'null'); } catch (e) { d = null; } if (!d) return false;
    $$('#caltable input').forEach(i => { const v = d.readings && d.readings[i.dataset.t] && d.readings[i.dataset.t][i.dataset.a]; i.value = v === '' || v == null || !isFinite(v) ? '' : v; });
    $('#rulerX').value = d.rulerX || ''; $('#rulerY').value = d.rulerY || '';
    if (d.code && Array.from($('#calCode').options).some(o => o.value === d.code)) $('#calCode').value = d.code; return true; }
  const sheetLabel = () => { const sh = sheetDims(), p = SHEETS[S.sheet] || SHEETS.letter; return `${S.sheet === 'custom' ? `Custom ${sh.w.toFixed(2)} × ${sh.h.toFixed(2)} in` : p.name.replace(/^US /, '').split(/ [\d(]/)[0]}${S.landscape ? ' landscape' : ''}`; };
  const LOAD = { had: {}, fromFile: {} }; // which sheet sizes had a saved calibration when the page loaded
  function calStatusLine() { const raw = STORE.get(calKey()), c = getCal(), saved = c.savedAt || (c.history && c.history.length ? c.history[c.history.length - 1].t : 0);
    const has = !!raw || !!STORE.get(corrKey()), comp = (c.ex || 1) !== 1 || (c.ey || 1) !== 1;
    const what = `${sheetLabel()}, ${comp ? `compensation ${fmtPct(c.ex - 1)}/${fmtPct(c.ey - 1)}` : 'no print compensation'}${c.mode ? `, mode ${c.mode}` : ''}, ${c.status === 'calibrated' ? '✓ calibrated' : `pass ${c.pass || 0}`}${saved ? `, saved ${new Date(saved).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`;
    const where = !STORE.ok ? ' <b class="warn">⚠ This browser is not keeping data for this page (storage blocked). It survives a refresh in this tab only; use Export calibration to keep it.</b>'
      : LOAD.fromFile[sheetDims().key] ? ' <span class="muted">(from the copy built into this HTML file)</span>'
      : STORE.restored ? ' <span class="warn">(browser storage had lost it; restored from this tab’s backup. Export a copy to be safe.)</span>' : '';
    if (!has) return `No saved calibration for ${sheetLabel()} yet. If you calibrated before and it is gone (cleared cache, moved file, other browser), use <b>Import calibration</b>.${where}`;
    return `${LOAD.had[sheetDims().key] ? 'Calibration loaded' : 'Calibration saved'}: ${what}.${where}`; }
  function calBundle() { const cal = {}; for (const k of STORE.keys()) if (/^cst\.(cal|draft)\./.test(k)) { try { cal[k] = JSON.parse(STORE.get(k)); } catch (e) { /* skip */ } } return cal; }
  function exportCal() { const code = stateCode(currentState());
    const data = { app: 'cricut-full-sheet-tool', kind: 'calibration', v: 1, exported: new Date().toISOString(), applyCorr: S.applyCorr, sheet: { sheet: S.sheet, landscape: S.landscape, customW: S.customW, customH: S.customH }, cal: calBundle() };
    download(`cricut-calibration-${sheetDims().key}-${code}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json'); return data; }
  function saveToolCopy() { // this HTML file with the current calibration built in: opening it anywhere restores the calibration
    const data = { kind: 'calibration', v: 1, exported: new Date().toISOString(), applyCorr: S.applyCorr, cal: calBundle() };
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    const html = PRISTINE.replace(/(<script id="cstEmbedded" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + json + b);
    if (html === PRISTINE) throw new Error('Could not find the calibration slot in this page');
    download(`cricut_print_assistant-calibrated-${stateCode(currentState())}.html`, html, 'text/html'); return html.length; }
  /** writes the calibration from an exported file or a project file; returns the number of sheet sizes written (0 = cancelled) */
  function importCalData(d, ask) {
    const cal = d && (d.kind === 'calibration' ? d.cal : d.calibration); if (!cal || typeof cal !== 'object') throw new Error('No calibration in that file');
    const keys = Object.keys(cal).filter(k => /^cst\.(cal|draft)\./.test(k)); if (!keys.length) throw new Error('No calibration in that file');
    const calKeys = keys.filter(k => k.startsWith('cst.cal.'));
    const clash = calKeys.filter(k => { const cur = STORE.get(k); return cur && cur !== JSON.stringify(cal[k]); });
    if (ask && clash.length && !confirm(`Replace the calibration saved in this browser for ${clash.map(k => k.slice(8)).join(', ')} with the one from the file?`)) return 0;
    for (const k of keys) { const v = Object.assign(k.startsWith('cst.cal.') ? C.calDefault() : {}, cal[k]); STORE.set(k, JSON.stringify(v)); if (k.startsWith('cst.cal.')) STORE.set('cst.corr.' + k.slice(8), JSON.stringify(C.calCutCorr(v))); }
    if (d.kind === 'calibration' && d.applyCorr !== undefined) { S.applyCorr = !!d.applyCorr; saveSettings(); }
    return calKeys.length; }
  const getCorr = () => C.calCutCorr(getCal());                         // derived cut-file correction
  const setCorr = (k) => { const c = getCal(); c.Q = C.normCorr(k); c.ex = 1; c.ey = 1; saveCal(c); }; // legacy API: set cut correction directly
  const activeCorr = () => S.applyCorr ? getCorr() : C.IDENTITY;
  const activeComp = () => { const c = getCal(); return S.applyCorr ? { ex: c.ex || 1, ey: c.ey || 1 } : { ex: 1, ey: 1 }; };
  function printer(sh) { const k = activeComp(); return C.printMap(k.ex, k.ey, sh.w / 2, sh.h / 2); }
  function corrector(sh) { return C.makeCorrector(activeCorr(), sh.w / 2, sh.h / 2); }
  /** per-side margins: start from the user's margin and grow a side only if the calibration shift would push cuts past the corner anchors */
  function effMargins(sh) {
    const f = corrector(sh), P = printer(sh), g = S.inset + 0.05, pg = 0.03, b = S.bleed, m = { l: S.margin, t: S.margin, r: S.margin, b: S.margin };
    for (let it = 0; it < 8; it++) {
      const pts = [[m.l, m.t], [sh.w - m.r, m.t], [m.l, sh.h - m.b], [sh.w - m.r, sh.h - m.b]].map(([x, y]) => f(x, y));
      const pp = [[m.l - b, m.t - b], [sh.w - m.r + b, m.t - b], [m.l - b, sh.h - m.b + b], [sh.w - m.r + b, sh.h - m.b + b]].map(([x, y]) => P(x, y)); // enlarged print incl. bleed
      const vl = Math.max(g - Math.min(...pts.map(p => p[0])), pg - Math.min(...pp.map(p => p[0]))), vt = Math.max(g - Math.min(...pts.map(p => p[1])), pg - Math.min(...pp.map(p => p[1])));
      const vr = Math.max(Math.max(...pts.map(p => p[0])) - (sh.w - g), Math.max(...pp.map(p => p[0])) - (sh.w - pg)), vb = Math.max(Math.max(...pts.map(p => p[1])) - (sh.h - g), Math.max(...pp.map(p => p[1])) - (sh.h - pg));
      const E = 1e-9; if (vl <= E && vt <= E && vr <= E && vb <= E) break;
      if (vl > E) m.l += vl + 0.002; if (vt > E) m.t += vt + 0.002; if (vr > E) m.r += vr + 0.002; if (vb > E) m.b += vb + 0.002;
    }
    return m;
  }
  const fmtPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}%`;
  const pctTxt = (v) => `${Math.abs(v * 100).toFixed(2)}% ${v >= 0 ? 'larger' : 'smaller'}`;
  const mmTxt = (v, pos, neg) => `${Math.abs(v * MM).toFixed(2)} mm ${v >= 0 ? pos : neg}`;
  function corrWords() { const c = getCal(), q = C.normCorr(c.Q), th = (q.a21 - q.a12) / 2;
    if (Math.abs(q.a11 - 1) < 1e-7 && Math.abs(q.a22 - 1) < 1e-7 && Math.abs(th) < 1e-9 && Math.abs(q.tx) < 1e-9 && Math.abs(q.ty) < 1e-9 && (c.ex || 1) === 1 && (c.ey || 1) === 1) return 'none (not calibrated yet)';
    const cutRot = -th * 180 / Math.PI;
    return `printer prints at ${(q.a11 * 100).toFixed(2)}% × ${(q.a22 * 100).toFixed(2)}% · print compensation ${(c.ex || 1) === 1 && (c.ey || 1) === 1 ? 'off' : `${fmtPct(c.ex - 1)} / ${fmtPct(c.ey - 1)}`} · cut lines follow the ink (rotation ${Math.abs(cutRot).toFixed(2)}° ${cutRot >= 0 ? 'cw' : 'ccw'}, shift ${(-q.tx * MM).toFixed(2)} / ${(-q.ty * MM).toFixed(2)} mm)${c.status === 'calibrated' ? ' · ✓ verified' : c.pass ? ` · pass ${c.pass}, not verified yet` : ''}`; }
  const corrMeta = (k) => { k = C.normCorr(k); return `A=[${[k.a11, k.a12, k.a21, k.a22].map(v => v.toFixed(6)).join(',')}] t=[${(k.tx * MM).toFixed(3)},${(k.ty * MM).toFixed(3)}]mm about sheet centre`; };
  const saveSettings = () => STORE.set('cst.settings', JSON.stringify(S));

  // ---------- image loading ----------
  function readAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
  function readAsText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }
  function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode image')); i.src = url; }); }
  const CANVAS_MAX = 16777216;
  function touchDevice() { return document.documentElement.classList.contains('big') || window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches; }
  function budgetDpi(it) {
    const dpi = S.dpi || 300; if (!touchDevice()) return dpi;
    const extra = 2 * ((+it.offsetIn || 0) + (S.bleed || 0));
    const w = Math.max(0.1, it.wIn + extra), h = Math.max(0.1, it.hIn + extra), px = w * dpi * h * dpi;
    if (px <= CANVAS_MAX) return dpi;
    const next = Math.max(72, Math.floor(Math.sqrt(CANVAS_MAX / (w * h))));
    const note = 'printed at ' + next + ' dpi to fit iPad memory';
    const el = document.getElementById('dpiNote'); if (el) { el.hidden = false; el.textContent = note; }
    return next;
  }
  function releaseCanvas(p) { const c = p && p.print && p.print.canvas; if (c) c.width = 0; }
  async function shrinkImport(img) {
    const m = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
    if (!touchDevice() || m <= 4096) return img;
    const k = 4096 / m, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png'); c.width = 0; return loadImg(url);
  }
  function fixSvgText(t) { // make sure the root <svg> has explicit pixel width/height so browsers rasterize it reliably
    const doc = new DOMParser().parseFromString(t, 'image/svg+xml'), svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG');
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const num = (a) => { const m = /^([\d.]+)\s*(px|pt|in|mm|cm)?$/.exec((a || '').trim()); if (!m) return null; const k = { px: 1, pt: 96 / 72, in: 96, mm: 96 / 25.4, cm: 96 / 2.54 }[m[2] || 'px']; return +m[1] * k; };
    let w = num(svg.getAttribute('width')), h = num(svg.getAttribute('height'));
    if (!(w && h)) { if (vb.length === 4 && vb[2] > 0) { const asp = vb[3] / vb[2]; w = w || (h ? h / asp : vb[2]); h = h || w * asp; } /* viewBox units = CSS px */ else { w = w || 1000; h = h || 1000; } }
    const sc = 2000 / Math.max(w, h); // rasterize source large enough
    if (!svg.getAttribute('data-cst-natw-in')) svg.setAttribute('data-cst-natw-in', (w / 96).toFixed(5)); // declared size = 100%
    svg.setAttribute('width', w * sc); svg.setAttribute('height', h * sc);
    return new XMLSerializer().serializeToString(svg);
  }
  async function addFile(file) {
    const isSvg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
    let dataURL, srcURL;
    if (isSvg) { const t = fixSvgText(await readAsText(file)); dataURL = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t))); srcURL = dataURL; }
    else { dataURL = await readAsDataURL(file); srcURL = dataURL; }
    return addFromDataURL(file.name, dataURL, srcURL, isSvg);
  }
  const BASE_DPI = 300; // 100% = original pixel size printed at 300 dpi (SVG: its declared size)
  function svgBaseWidth(dataURL) { try { const t = decodeURIComponent(escape(atob(dataURL.split(',')[1]))); const m = /data-cst-natw-in="([\d.]+)"/.exec(t); return m ? +m[1] : null; } catch (e) { return null; } }
  const pctOf = (it) => it.wIn / it.baseWIn * 100;
  function setPct(it, pct) { const asp = it.wIn > 0 && it.hIn > 0 ? it.hIn / it.wIn : it.natH / it.natW; // keeps the current W:H ratio
    it.wIn = Math.max(0.1, it.baseWIn * pct / 100); it.hIn = it.wIn * asp; it.pct = pctOf(it); }
  async function addFromDataURL(name, dataURL, srcURL, isSvg, saved) {
    const img = await shrinkImport(await loadImg(srcURL || dataURL));
    const nw = img.naturalWidth || 1000, nh = img.naturalHeight || 1000;
    const t = document.createElement('canvas'), k = Math.min(1, 256 / Math.max(nw, nh)); t.width = Math.max(1, Math.round(nw * k)); t.height = Math.max(1, Math.round(nh * k));
    const g = t.getContext('2d'); g.drawImage(img, 0, 0, t.width, t.height); const d = g.getImageData(0, 0, t.width, t.height).data;
    let transp = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) transp++;
    const hasAlpha = transp > d.length / 4 * 0.005, L = 2, asp = nh / nw;
    const it = Object.assign({ id: nextId++, name, dataURL, isSvg, img, natW: nw, natH: nh, hasAlpha,
      wIn: asp <= 1 ? L : L / asp, hIn: asp <= 1 ? L * asp : L, qty: 1,
      shape: hasAlpha ? 'contour' : 'rect', radiusIn: 0.125, offsetIn: hasAlpha ? 0.0 : 0, border: 'extend', rotate: true }, saved || {});
    it.img = img; it.dataURL = dataURL; it.warp = warpClean(it.warp);
    it.baseWIn = (isSvg && svgBaseWidth(dataURL)) || nw / BASE_DPI;
    if (saved && saved.wIn == null && saved.pct != null) setPct(it, saved.pct); // project saved with % only
    it.pct = pctOf(it); items.push(it); return it;
  }

  // ---------- processing & layout ----------
  function procKey(it, base) { const k = [it.id, it.wIn.toFixed(4), it.hIn.toFixed(4), it.shape, it.radiusIn, it.offsetIn, it.border, S.bleed, S.dpi]; if (!base && isWarped(it)) k.push(it.warp); return JSON.stringify(k); }
  function baseEntry(it) { const k = procKey(it, true); let e = cache.get(k);
      if (!e) { e = { p: C.processItem(it.img, { wIn: it.wIn, hIn: it.hIn, shape: it.shape, radiusIn: it.radiusIn, offsetIn: it.offsetIn, bleedIn: S.bleed, border: it.border, dpi: budgetDpi(it) }) }; cache.set(k, e); }
    return e; }
  const warpedKeys = new Map();
  /** what prints and cuts: the image's own processing, with its Mockup warp (it.warp) baked in when it has one */
  function processed(it, rot) { let e;
    if (isWarped(it)) { const k = procKey(it); e = cache.get(k);
      if (!e) { const b = baseEntry(it).p, M = warpMap(it, { w: b.cutW, h: b.cutH }); e = { p: C.warpProcessed(b, M.f, M.inv, S.dpi) };
        const old = warpedKeys.get(it.id); if (old && old !== k) { releaseCanvas((cache.get(old) || {}).p); cache.delete(old); } warpedKeys.set(it.id, k); cache.set(k, e); } }
    else e = baseEntry(it);
    if (rot && !e.r) e.r = C.rotateProcessed(e.p);
    return rot ? e.r : e.p;
  }
  /** the unwarped processing: the Mockup's piece box (its warp is drawn on top of this) */
  const processedBase = (it) => baseEntry(it).p;
  // ---------- manual placement (drag on the canvas) ----------
  // manual = null → auto-pack. Otherwise { pieces: { 'itemId#copy': { s: sheet, x, y, rot } } } with x/y = top-left of the piece's
  // cut box in sheet inches (the same numbers the auto-packer produces), so export takes exactly the same path either way.
  let manual = null;
  const pieceKey = (it, q) => it.id + '#' + q;
  const rectOf = (e) => ({ x: e.x, y: e.y, w: e.p.cutW, h: e.p.cutH });
  const hits = (a, b, sp) => { const t = 1e-6; return a.x < b.x + b.w + sp - t && b.x < a.x + a.w + sp - t && a.y < b.y + b.h + sp - t && b.y < a.y + a.h + sp - t; };
  const boundsOf = (L) => ({ x0: L.m.l, y0: L.m.t, x1: L.m.l + L.uw, y1: L.m.t + L.uh });
  const fitsIn = (r, B) => { const t = 1e-6; return r.x >= B.x0 - t && r.y >= B.y0 - t && r.x + r.w <= B.x1 + t && r.y + r.h <= B.y1 + t; };
  function clampTo(r, B) { r.x = Math.max(B.x0, Math.min(r.x, B.x1 - r.w)); r.y = Math.max(B.y0, Math.min(r.y, B.y1 - r.h)); return r; }
  function freeAt(list, r, sp, skip) { for (const e of list) if (e !== skip && hits(r, rectOf(e), sp)) return false; return true; }
  /** nearest free spot to `near` (within near.r in), or the first free top-left spot when near is null */
  function findSpot(list, w, h, B, sp, near, skip) {
    if (w > B.x1 - B.x0 + 1e-9 || h > B.y1 - B.y0 + 1e-9) return null;
    const others = list.filter(e => e !== skip).map(rectOf);
    const xs = [B.x0, B.x1 - w], ys = [B.y0, B.y1 - h];
    for (const o of others) { xs.push(o.x + o.w + sp, o.x - sp - w, o.x); ys.push(o.y + o.h + sp, o.y - sp - h, o.y); }
    const ok = (x, y) => { const r = { x, y, w, h }; if (!fitsIn(r, B)) return false; for (const o of others) if (hits(r, o, sp)) return false; return true; };
    if (!near) { const yy = [...new Set(ys)].sort((a, b) => a - b), xx = [...new Set(xs)].sort((a, b) => a - b);
      for (const y of yy) for (const x of xx) if (ok(x, y)) return { x, y, w, h }; return null; }
    const R = near.r || 1.5, g = 1 / 32, cx = [near.x, ...xs], cy = [near.y, ...ys];
    for (let d = g; d <= R + 1e-9; d += g) { cx.push(near.x - d, near.x + d); cy.push(near.y - d, near.y + d); }
    let best = null, bd = Infinity;
    for (const y of cy) { const dy = (y - near.y) ** 2; if (dy >= bd) continue; for (const x of cx) { const d = (x - near.x) ** 2 + dy; if (d < bd && d <= R * R + 1e-9 && ok(x, y)) { bd = d; best = { x, y, w, h }; } } }
    return best;
  }
  function manualSheets(sh, m, uw, uh, sp) {
    const B = { x0: m.l, y0: m.t, x1: m.l + uw, y1: m.t + uh }, want = [], out = [], pending = []; let moved = 0, unplaced = 0;
    for (const it of items) for (let q = 0; q < it.qty; q++) want.push({ it, key: pieceKey(it, q) });
    const keep = new Set(want.map(w => w.key)); for (const k of Object.keys(manual.pieces)) if (!keep.has(k)) delete manual.pieces[k];
    for (const w of want) { const s = manual.pieces[w.key]; if (!s) { pending.push(w); continue; }
      const p = processed(w.it, !!s.rot), r = { x: s.x, y: s.y, w: p.cutW, h: p.cutH };
      if (r.w > uw + 1e-9 || r.h > uh + 1e-9) { pending.push(w); moved++; continue; }
      const list = out[s.s] || (out[s.s] = []); clampTo(r, B);
      if (!freeAt(list, r, sp)) { const n = findSpot(list, r.w, r.h, B, sp, { x: r.x, y: r.y, r: 1 }); if (!n) { pending.push(w); moved++; continue; } r.x = n.x; r.y = n.y; }
      if (Math.abs(r.x - s.x) > 1e-6 || Math.abs(r.y - s.y) > 1e-6) moved++;
      list.push({ it: w.it, key: w.key, x: r.x, y: r.y, rot: !!s.rot, p, o: s.o == null ? 1e9 : s.o });
    }
    for (let i = 0; i < out.length; i++) out[i] = out[i] || [];
    for (const w of pending) { let done = false;
      const rots = [false].concat(S.rotate && w.it.rotate ? [true] : []);
      for (let si = 0; si <= out.length && !done; si++) { const list = out[si] || []; for (const rot of rots) { const p = processed(w.it, rot), n = findSpot(list, p.cutW, p.cutH, B, sp, null);
        if (n) { if (!out[si]) out[si] = list; list.push({ it: w.it, key: w.key, x: n.x, y: n.y, rot, p }); done = true; break; } } }
      if (!done) unplaced++; }
    const sheets = out.filter(l => l && l.length); manual.pieces = {}; let o = 0;
    for (const l of sheets) l.sort((a, b) => (a.o == null ? 1e9 : a.o) - (b.o == null ? 1e9 : b.o)); // keep the stacking / export order stable
    sheets.forEach((l, si) => l.forEach(e => { delete e.o; manual.pieces[e.key] = { s: si, x: e.x, y: e.y, rot: e.rot, o: o++ }; }));
    return { sheets, moved, unplaced };
  }
  function computeLayout() {
    const sh = sheetDims(), mi = matInfo(sh), m = effMargins(sh), sp = S.spacing, uw = sh.w - m.l - m.r, uh = sh.h - m.t - m.b;
    const warn = [], info = []; let sheets, unplaced;
    if (!manual) {
      const rects = [];
      for (const it of items) { const p = processed(it, false); for (let q = 0; q < it.qty; q++) rects.push({ id: pieceKey(it, q), w: p.cutW + sp, h: p.cutH + sp, canRotate: it.rotate }); }
      const pk = C.packAll(rects, uw + sp, uh + sp, S.rotate);
      const byId = new Map(items.map(i => [String(i.id), i]));
      sheets = pk.sheets.map(pl => pl.map(r => { const it = byId.get(r.id.split('#')[0]); return { it, key: r.id, x: m.l + r.x, y: m.t + r.y, rot: r.rot, p: processed(it, r.rot) }; }));
      unplaced = pk.unplaced.length;
    } else {
      const r = manualSheets(sh, m, uw, uh, sp); sheets = r.sheets; unplaced = r.unplaced;
      if (r.moved) warn.push(`${r.moved} hand-placed piece${r.moved > 1 ? 's no longer fit where they were' : ' no longer fit where it was'} (size, margin or sheet changed) and ${r.moved > 1 ? 'were' : 'was'} moved to the nearest free space.`);
    }
    if (unplaced) warn.push(`${unplaced} cop${unplaced > 1 ? 'ies are' : 'y is'} too large for the usable area (${fmtLen(uw)} × ${fmtLen(uh)}) and were skipped.`);
    const mMin = Math.min(m.l, m.t, m.r, m.b);
    if (mMin - S.bleed < S.printerMargin - 1e-6) warn.push(`Bleed reaches ${fmtLen(mMin - S.bleed)} from the paper edge, inside your printer's ${fmtLen(S.printerMargin)} unprintable margin; raise the margin.`);
    if (Math.max(m.l, m.t, m.r, m.b) > S.margin + 1e-6) info.push(`Margins raised (left ${fmtLen(m.l)}, top ${fmtLen(m.t)}, right ${fmtLen(m.r)}, bottom ${fmtLen(m.b)}) so the calibration keeps every cut inside the corner anchors and the enlarged print on the page.`);
    const comp = activeComp(); if (comp.ex !== 1 || comp.ey !== 1) info.push(`Print compensation ON: the PDF is enlarged ${fmtPct(comp.ex - 1)} across / ${fmtPct(comp.ey - 1)} down (about the page centre) so your printer's shrink brings it back to true size. Print it at 100% with the same settings you calibrated with.`);
    if (!mi.ok) warn.push(mi.msg);
    layout = { sh, mi, m, uw, uh, sheets, warn, info, unplaced, manual: !!manual };
    if (curSheet >= sheets.length) curSheet = Math.max(0, sheets.length - 1);
    return layout;
  }
  function sheetCutLoops(sheetPl, sh) {
    const f = corrector(sh), loops = [];
    for (const pl of sheetPl) for (const l of pl.p.loops) loops.push(C.mapLoop(l, (x, y) => f(x + pl.x, y + pl.y)));
    return loops;
  }
  function validateCut(loops, sh) {
    const bb = C.loopBBox(loops), a = S.inset, d = 0.04 + 0.005;
    if (!loops.length) return null;
    if (bb.x0 < a + 0.002 || bb.y0 < a + 0.002 || bb.x1 > sh.w - a - 0.002 || bb.y1 > sh.h - a - 0.002) return 'Cut lines fall outside the anchor box; increase the margin.';
    void d; return null;
  }

  // ---------- export ----------
  const dataUrlCache = new WeakMap();
  function canvasURL(p) { let u = dataUrlCache.get(p.print.canvas); if (!u) { u = p.print.hasAlpha ? p.print.canvas.toDataURL('image/png') : p.print.canvas.toDataURL('image/jpeg', 0.95); dataUrlCache.set(p.print.canvas, u); } return u; }
  function newDoc(sh) { const { jsPDF } = window.jspdf; return new jsPDF({ unit: 'pt', format: [sh.w * PT, sh.h * PT], orientation: sh.w > sh.h ? 'landscape' : 'portrait', compress: true }); }
  /** drawing helper in DESIGN inches; applies the print compensation (axis-aligned enlargement about the page centre) */
  function pen(doc, sh) { const k = activeComp(), P = C.printMap(k.ex, k.ey, sh.w / 2, sh.h / 2);
    return { k, rect: (x, y, w, h) => { const [a, b] = P(x, y); doc.rect(a * PT, b * PT, w * k.ex * PT, h * k.ey * PT); },
      line: (x1, y1, x2, y2) => { const [a, b] = P(x1, y1), [c, d] = P(x2, y2); doc.line(a * PT, b * PT, c * PT, d * PT); },
      text: (t, x, y, o) => { const [a, b] = P(x, y); const op = Object.assign({}, o); if (op.maxWidth) op.maxWidth *= k.ex * PT; doc.text(t, a * PT, b * PT, op); },
      font: (n) => doc.setFontSize(n * k.ey),
      image: (url, fmt, x, y, w, h, al) => { const [a, b] = P(x, y); doc.addImage(url, fmt, a * PT, b * PT, w * k.ex * PT, h * k.ey * PT, al, 'FAST'); } }; }
  function drawAnchorMarks(doc, sh) {
    const g = pen(doc, sh), a = S.inset, dt = 0.04, t = 0.06; doc.setDrawColor(0); doc.setLineWidth(0.3);
    for (const [x, y, sx, sy] of [[a, a, -1, -1], [sh.w - a - dt, a, 1, -1], [a, sh.h - a - dt, -1, 1], [sh.w - a - dt, sh.h - a - dt, 1, 1]]) {
      g.rect(x, y, dt, dt);
      const cx = x + dt / 2, cy = y + dt / 2; // short outward ticks pointing at the corner
      g.line(cx, sy < 0 ? y : y + dt, cx, sy < 0 ? y - t : y + dt + t);
      g.line(sx < 0 ? x : x + dt, cy, sx < 0 ? x - t : x + dt + t, cy);
    }
  }
  // ---------- optional piece numbers on the print (OFF by default; print PDF + preview only, never the cut SVG) ----------
  const numOf = (it) => items.indexOf(it) + 1; // image number = position in the list (printed numbers when there is no mockup)
  /** assembly steps: #n = application order in the Mockup, #1 = the bottom-most visible layer (goes on first). Every copy has its own step; hidden layers get none, so the steps stay 1..N */
  function mkSteps() { const m = new Map(); let k = 0; for (const n of MK.nodes) { if (n.hidden || !nodeItem(n)) continue; m.set(n, ++k); } return m; }
  /** steps of one image, ascending */
  const stepsOf = (it, st) => { const o = []; for (const [n, k] of (st || mkSteps())) if (nodeItem(n) === it) o.push(k); return o; };
  /** short badge text for an image card / the Add list: its steps, or its image number when the mockup is empty */
  function stepBadge(it, st) { st = st || mkSteps(); if (!st.size) return { t: '#' + numOf(it), tip: `Image ${numOf(it)}: printed as #${numOf(it)} when "Print piece numbers" is on (no mockup yet)` };
    const s = stepsOf(it, st); if (!s.length) return { t: 'sp', tip: 'Not in the mockup (or only hidden layers): printed as "sp" (spare) when "Print piece numbers" is on' };
    return { t: '#' + (s.length > 3 ? s.slice(0, 2).join(',#') + ',…' : s.join(',#')), tip: `Assembly step${s.length > 1 ? 's' : ''} #${s.join(', #')} in the Mockup guide (#1 goes on first). "Print piece numbers" prints these on the cut sheet.` }; }
  /** printed piece numbers with a mockup: each piece = an assembly step. Copies of one image take that image's steps in reading order
   *  (sheet 1 first, then top to bottom, left to right); pieces beyond the copies in the mockup print 'sp' (spare). No visible mockup piece -> null (image numbers, as before). */
  function cutStepLabels(L) { const st = mkSteps(); if (!st.size || !L) return null; const by = new Map(), out = new Map();
    for (const [n, k] of st) { const it = nodeItem(n); if (!by.has(it)) by.set(it, []); by.get(it).push(k); }
    const all = []; L.sheets.forEach((pl, si) => pl.forEach(e => all.push({ si, e, ry: Math.round(e.y * 10) })));
    all.sort((a, b) => a.si - b.si || a.ry - b.ry || a.e.x - b.e.x);
    const used = new Map(); for (const { e } of all) { const s = by.get(e.it) || [], i = used.get(e.it) || 0; used.set(e.it, i + 1); out.set(e.key, i < s.length ? String(s[i]) : 'sp'); }
    return out; }
  const flatCache = new WeakMap();
  function flatLoops(p) { let f = flatCache.get(p); if (f) return f;
    f = p.loops.map(l => { const pts = []; let cx = 0, cy = 0;
      for (const s of l) { if (s[0] === 'M' || s[0] === 'L') { cx = s[1]; cy = s[2]; pts.push([cx, cy]); }
        else if (s[0] === 'C') { for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; pts.push([u * u * u * cx + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5], u * u * u * cy + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6]]); } cx = s[5]; cy = s[6]; } }
      return pts; });
    flatCache.set(p, f); return f; }
  /** is sheet point (x, y) on the sticker itself (inside the cut, even-odd so holes count as waste)? */
  function insidePiece(e, x, y) { const lx = x - e.x, ly = y - e.y; if (lx < 0 || ly < 0 || lx > e.p.cutW || ly > e.p.cutH) return false; let c = 0;
    for (const poly of flatLoops(e.p)) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > ly) !== (yj > ly) && lx < (xj - xi) * (ly - yi) / (yj - yi) + xi) c++; }
    return c % 2 === 1; }
  /** label boxes for one sheet: on the waste inside the piece's cut box (contour corners) or just outside it, ≥ LABEL_CLEAR from every cut; inside the sticker only as a last resort */
  const LABEL_H = 0.085, LABEL_CLEAR = 0.03;
  function pieceLabels(pl, sh) { const out = [], H = LABEL_H, mg = LABEL_CLEAR, pm = Math.max(S.printerMargin || 0, 0.05), SL = cutStepLabels(layout);
    for (const e of pl) { const t = SL ? (SL.get(e.key) || 'sp') : String(numOf(e.it)), W = 0.05 * t.length + 0.045, x = e.x, y = e.y, w = e.p.cutW, h = e.p.cutH, gap = Math.max(mg, (S.spacing - H) / 2);
      const c = [];
      for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.push([x + mg + fx * (w - W - 2 * mg), y + mg + fy * (h - H - 2 * mg)]);
      c.push([x + w / 2 - W / 2, y + h + gap], [x, y + h + gap], [x + w - W, y + h + gap], [x + w / 2 - W / 2, y - H - gap], [x, y - H - gap], [x + w - W, y - H - gap], [x - W - gap, y + h / 2 - H / 2], [x + w + gap, y + h / 2 - H / 2]);
      let spot = null;
      for (const [cx, cy] of c) { const r = { x: cx, y: cy, w: W, h: H };
        if (r.x < pm || r.y < pm || r.x + W > sh.w - pm || r.y + H > sh.h - pm) continue;
        if (out.some(o => r.x < o.x + o.w + 0.01 && o.x < r.x + W + 0.01 && r.y < o.y + o.h + 0.01 && o.y < r.y + H + 0.01)) continue;
        let clear = true;
        for (let iy = 0; iy <= 4 && clear; iy++) for (let ix = 0; ix <= 6 && clear; ix++) { const px = r.x - mg + (W + 2 * mg) * ix / 6, py = r.y - mg + (H + 2 * mg) * iy / 4; for (const o of pl) if (insidePiece(o, px, py)) { clear = false; break; } }
        if (clear) { spot = r; break; } }
      if (!spot) spot = { x: x + w / 2 - W / 2, y: y + h / 2 - H / 2, w: W, h: H, inside: true };
      out.push(Object.assign(spot, { t, key: e.key })); }
    return out; }
  function drawPdfLabels(doc, sh, pl) { const k = activeComp(), P = C.printMap(k.ex, k.ey, sh.w / 2, sh.h / 2);
    doc.setLineWidth(0.25); doc.setDrawColor(150); doc.setFillColor(255, 255, 255); doc.setTextColor(40); doc.setFontSize(5 * k.ey);
    for (const lb of pieceLabels(pl, sh)) { const [a, b] = P(lb.x, lb.y), w = lb.w * k.ex, h = lb.h * k.ey;
      doc.rect(a * PT, b * PT, w * PT, h * PT, 'FD'); doc.text(lb.t, (a + w / 2) * PT, (b + h * 0.76) * PT, { align: 'center' }); }
    doc.setDrawColor(0); doc.setTextColor(0); doc.setFillColor(0); }
  function buildPDF() {
    const L = layout || computeLayout(), sh = L.sh; if (!L.sheets.length) throw new Error('Nothing to export - add images first.');
    const doc = newDoc(sh), aliases = new Map(), g = pen(doc, sh); let n = 0;
    L.sheets.forEach((pl, si) => {
      if (si > 0) doc.addPage([sh.w * PT, sh.h * PT], sh.w > sh.h ? 'landscape' : 'portrait');
      for (const e of pl) {
        const pr = e.p.print; let al = aliases.get(pr.canvas); if (!al) { al = 'img' + (n++); aliases.set(pr.canvas, al); }
        g.image(canvasURL(e.p), pr.hasAlpha ? 'PNG' : 'JPEG', e.x + pr.x, e.y + pr.y, pr.w, pr.h, al);
      }
      if (S.numberPieces) drawPdfLabels(doc, sh, pl);
      if (S.marks) drawAnchorMarks(doc, sh);
    });
    return doc;
  }
  function buildSVGs() {
    const L = layout || computeLayout(), sh = L.sh, c = activeCorr();
    return L.sheets.map((pl, si) => {
      const loops = sheetCutLoops(pl, sh), err = validateCut(loops, sh); if (err) throw new Error(`Sheet ${si + 1}: ${err}`);
      const meta = `Cricut full-sheet cut file. Sheet ${sh.w.toFixed(3)}x${sh.h.toFixed(3)} in, page ${si + 1}/${L.sheets.length}. Canvas = anchor box ${(sh.w - 2 * S.inset).toFixed(3)}x${(sh.h - 2 * S.inset).toFixed(3)} in starting ${S.inset} in from the sheet's top-left. Correction ${corrMeta(c)}`;
      return C.buildCutSVG(sh, S.inset, S.anchor, loops, meta);
    });
  }
  function download(name, data, type) { const b = data instanceof Blob ? data : new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function saveBlob(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    if (window.CST && window.CST.pwa && window.CST.pwa.shareOrDownload) return window.CST.pwa.shareOrDownload(name, blob);
    download(name, blob);
  }
  function noteFileSave() { try { localStorage.setItem('cst.fileSaveAt', String(Date.now())); } catch (e) { /* ignore */ } }
  async function storageNudge() {
    let old = 0; try { old = +localStorage.getItem('cst.fileSaveAt') || 0; } catch (e) { old = 0; }
    if (old && Date.now() - old > 7 * 864e5) toast('It has been a week since you saved a file. Save a copy so a browser cleanup cannot drop this work.');
    let persisted = true;
    try { persisted = !(navigator.storage && navigator.storage.persisted) || await navigator.storage.persisted(); } catch (e) { persisted = false; }
    let dismissed = false; try { dismissed = sessionStorage.getItem('cst.storageNudge') === '1'; } catch (e) { dismissed = false; }
    const el = $('#storageNudge'); if (el) el.hidden = !(touchDevice() && !persisted && !dismissed);
  }
  const base = () => 'sheet-' + sheetDims().key;

  // ---------- calibration ----------
  // target layout: v1 = 0.5 in squares 1.0 in from the edges with ±4 mm scales (sheets made by earlier versions, and "no code");
  // v2 = 0.875 in squares 1.15 in from the edges with ±8 mm scales (the cut slit still crosses both scales up to ±8 mm, 3 mm to spare)
  const CAL_LAYOUT = 2, SCALE_MM = 8;
  const calSq = (layout) => (layout || 1) >= 2 ? 0.875 : 0.5;
  function calTargets(sh, layout) { const a = S.inset + ((layout || CAL_LAYOUT) >= 2 ? 0.9 : 0.75); return [
    { id: 'T1', label: 'top-left', x: a, y: a }, { id: 'T2', label: 'top-right', x: sh.w - a, y: a }, { id: 'T3', label: 'center', x: sh.w / 2, y: sh.h / 2 },
    { id: 'T4', label: 'bottom-left', x: a, y: sh.h - a }, { id: 'T5', label: 'bottom-right', x: sh.w - a, y: sh.h - a }]; }
  // state the calibration files are generated with (identity when "Apply calibration" is off)
  // calibration files ALWAYS use the saved calibration (the Layout tab's "Apply calibration" switch only affects real sheets);
  // otherwise switching it off silently produced uncorrected calibration sheets (code KGKF) after a choice was made
  function currentState() { const c = getCal(); return { Q: C.normCorr(c.Q), ex: c.ex || 1, ey: c.ey || 1, mode: c.mode, layout: CAL_LAYOUT }; }
  function withCal(fn) { const was = S.applyCorr; S.applyCorr = true; try { return fn(); } finally { S.applyCorr = was; } }
  const stateCode = (st) => C.calCode(st.Q, st.ex, st.ey, st.layout);
  function recordIssued() { const c = getCal(), st = currentState(), code = stateCode(st); c.issued = c.issued || {};
    if (!c.issued[code]) { c.issued[code] = { Q: st.Q, ex: st.ex, ey: st.ey, mode: st.mode, layout: st.layout, t: Date.now() };
      const keys = Object.keys(c.issued).sort((a, b) => c.issued[b].t - c.issued[a].t); for (const k of keys.slice(12)) delete c.issued[k]; }
    c.lastIssued = code; saveCal(c); return code; }
  function stateForCode(code) { if (code === 'none') return { Q: C.IDENTITY, ex: 1, ey: 1, mode: null, layout: 1 }; const c = getCal(), is = c.issued && c.issued[code];
    return is ? Object.assign({ layout: 1 }, is) : currentState(); }
  function buildCalPDF() { return withCal(buildCalPDF_); }
  function buildCalPDF_() {
    const SQ = calSq(CAL_LAYOUT), sh = sheetDims(), doc = newDoc(sh), g = pen(doc, sh), half = SQ / 2, mm = 1 / MM, code = recordIssued(), cal = getCal(), st = currentState();
    drawAnchorMarks(doc, sh);
    for (const t of calTargets(sh, CAL_LAYOUT)) {
      const L = t.x - half, T = t.y - half; doc.setLineWidth(0.4); doc.setDrawColor(0); g.rect(L, T, SQ, SQ);
      // X scale: a row of vertical ticks along y = centre, crossing the square's LEFT edge (0 = the printed edge, + = cut to the right)
      // Y scale: a column of horizontal ticks along x = centre, crossing the TOP edge (0 = the printed edge, + = cut lower)
      // ticks every 0.5 mm; 1 mm mid-length; 2 mm long + number. Numbers outside the scale band so the slit never hides them.
      doc.setLineWidth(0.2); g.font(4.6);
      for (let k = -2 * SCALE_MM; k <= 2 * SCALE_MM; k++) {
        const two = k % 4 === 0, one = k % 2 === 0, len = two ? 0.07 : one ? 0.05 : 0.03, xk = L + k * 0.5 * mm, yk = T + k * 0.5 * mm;
        g.line(xk, t.y - len, xk, t.y + len); g.line(t.x - len, yk, t.x + len, yk);
        if (two) { const v = k === 0 ? '0' : (k > 0 ? '+' : '-') + Math.abs(k / 2), main = k % 8 === 0; // 0, ±4, ±8 on one side; ±2, ±6 on the other
          g.text(v, xk, main ? t.y - 0.085 : t.y + 0.128, { align: 'center' });
          g.text(v, main ? t.x + 0.085 : t.x - 0.085, yk + 0.022, { align: main ? 'left' : 'right' }); }
      }
      doc.setLineWidth(0.35); g.line(L, t.y - 0.09, L, t.y + 0.09); g.line(t.x - 0.09, T, t.x + 0.09, T); // heavier zero lines
      g.font(4.2); g.text('X mm (+ = cut right)', L + 0.03, t.y + 0.2); g.text('Y mm (+ = cut lower)', t.x - 0.2, T - SCALE_MM * mm - 0.035, { align: 'left' });
      g.font(5.5); g.text(`${t.id} ${t.label}`, L, T + SQ + 0.1);
    }
    g.font(7);
    const bw = sh.w - 2 * S.inset, bh = sh.h - 2 * S.inset;
    g.text(`Calibration sheet ${sh.w.toFixed(2)} x ${sh.h.toFixed(2)} in. Print at 100% / Actual size. Scale check: outer corners of the 4 tiny corner squares should be ${bw.toFixed(3)} x ${bh.toFixed(3)} in (${(bw * MM).toFixed(1)} x ${(bh * MM).toFixed(1)} mm) apart.`, sh.w / 2, sh.h / 2 + 1.0, { align: 'center', maxWidth: sh.w - 2 });
    g.text('Read where each CUT line crosses the printed scale: left edge of the square -> X, top edge -> Y. Enter the numbers in the Calibrate tab.', sh.w / 2, sh.h / 2 + 1.35, { align: 'center', maxWidth: sh.w - 2 });
    const noComp = st.ex === 1 && st.ey === 1, compTxt = noComp ? 'NONE' : `${fmtPct(st.ex - 1)} across / ${fmtPct(st.ey - 1)} down`;
    const inPdf = `${(bw * st.ex).toFixed(3)} x ${(bh * st.ey).toFixed(3)} in`, onPaper = `${bw.toFixed(3)} x ${bh.toFixed(3)} in`;
    g.font(9); g.text(`Sheet code ${code}  ·  pass ${(cal.pass || 0) + 1}  ·  print compensation ${compTxt}`, sh.w / 2, sh.h / 2 + 1.75, { align: 'center' });
    g.font(7.5); g.text(noComp ? `Corner marks: ${onPaper} in this PDF (no enlargement). A printer that shrinks the page will make them shorter on paper.`
      : `Expected ruler reading on paper: ${onPaper}  ·  in the PDF itself: ${inPdf}. If the paper still measures short, this enlargement didn't reach the paper.`, sh.w / 2, sh.h / 2 + 1.98, { align: 'center', maxWidth: sh.w - 2 });
    g.font(8); g.text(`CODE ${code}  ·  COMPENSATION ${noComp ? 'NONE' : `${fmtPct(st.ex - 1)} / ${fmtPct(st.ey - 1)}`}  ·  PDF marks ${inPdf}`, sh.w / 2, S.inset + 0.62, { align: 'center' });
    return doc;
  }
  function buildCalSVG() { return withCal(buildCalSVG_); }
  function buildCalSVG_() {
    const SQ = calSq(CAL_LAYOUT), sh = sheetDims(), f = corrector(sh), half = SQ / 2, code = recordIssued();
    const loops = calTargets(sh, CAL_LAYOUT).map(t => C.mapLoop(C.roundedRectLoop(t.x - half, t.y - half, SQ, SQ, 0), f));
    return C.buildCutSVG(sh, S.inset, S.anchor, loops, `Cricut full-sheet CALIBRATION cut file, sheet code ${code}. Sheet ${sh.w.toFixed(3)}x${sh.h.toFixed(3)} in. Correction applied ${corrMeta(activeCorr())}`);
  }
  /** readings {T1:{x:mm,y:mm},...} from a sheet made with `code` ('none' = an uncorrected sheet). Fits the printer model absolutely. */
  function computeCalibration(readings, code, opts) { opts = opts || {};
    const sh = sheetDims(), cx = sh.w / 2, cy = sh.h / 2, st = stateForCode(code || getCal().lastIssued || 'none'), cal = getCal();
    const P = C.printMap(st.ex, st.ey, cx, cy), F = C.makeCorrector(C.calCutCorr(st), cx, cy), num = (v) => v === '' || v == null || !isFinite(+v) ? NaN : +v / MM;
    const samples = calTargets(sh, st.layout).map(t => { const [yx, yy] = P(t.x, t.y), [fx, fy] = F(t.x, t.y), r = readings[t.id] || {}; return { id: t.id, px: t.x, py: t.y, yx, yy, fx, fy, rx: num(r.x), ry: num(r.y) }; });
    const fit = C.calFit(samples, cx, cy), pat = C.readingPattern(samples, cx, cy), tg = calTargets(sh, st.layout);
    const hist = (cal.history || []).filter(h => isFinite(h.psx) && h.code !== code), prev = hist[hist.length - 1];
    const ru = typeof document !== 'undefined' && $('#rulerX') ? readRuler() : {}, bw = sh.w - 2 * S.inset, bh = sh.h - 2 * S.inset;
    const v = C.judgePass({ samples, fit, pat, ex: st.ex, ey: st.ey, mode: st.mode || cal.mode, tol: cal.tol || 0.5 / MM, spanX: tg[1].x - tg[0].x, spanY: tg[3].y - tg[0].y,
      prev, ruler: { x: isFinite(ru.x) ? ru.x / bw : NaN, y: isFinite(ru.y) ? ru.y / bh : NaN }, ignoreBad: !!opts.ignoreBad });
    v.fix = C.suggestFixes(samples, cx, cy); v.dropped = opts.drop || null; v.forced = !!opts.ignoreBad;
    if (v.status === 'bad-reading' && v.fix) v.bad = [v.fix.id]; // a swapped/sign-flipped target explains it better than the leave-one-out guess
    // safeguard: a sheet made before the current calibration (e.g. before choosing compensation) can't verify it
    const cur = currentState(), curCode = stateCode(cur);
    if (code !== curCode && cal.mode && (Math.abs(st.ex - cur.ex) > 1e-3 || Math.abs(st.ey - cur.ey) > 1e-3) && v.status !== 'incomplete' && v.status !== 'bad-reading')
      v.stale = { code, curCode, sheetEx: st.ex, sheetEy: st.ey, curEx: cur.ex, curEy: cur.ey, sheetHasComp: st.ex !== 1 || st.ey !== 1 };
    return { samples, fit, pat, v, st, code, nx: fit.nX, ny: fit.nY, corr: C.calCutCorr(Object.assign({}, st, { Q: fit.Q })), m: fit.q };
  }
  // ---------- calibration wizard UI ----------
  let lastResult = null;
  function readRuler() { const sh = sheetDims(), conv = (v) => { v = parseFloat(v); if (!isFinite(v) || v <= 0) return NaN; return v > 50 ? v / MM : v; };
    return { x: conv($('#rulerX').value), y: conv($('#rulerY').value), ex: sh.w - 2 * S.inset, ey: sh.h - 2 * S.inset }; }
  function compFromResult(r, useRuler) { // total print enlargement giving true size
    let ex = 1 / r.fit.q.qx, ey = 1 / r.fit.q.qy; const ru = readRuler();
    if (useRuler) { if (isFinite(ru.x)) ex = 1 / C.rulerShrink(ru.x, ru.ex, r.st.ex).scale; if (isFinite(ru.y)) ey = 1 / C.rulerShrink(ru.y, ru.ey, r.st.ey).scale; }
    return { ex, ey }; }
  function saveResult(r, patch) { const c = getCal(); c.Q = r.fit.Q; c.pass = (c.pass || 0) + 1; Object.assign(c, patch || {});
    c.history = (c.history || []).concat([{ pass: c.pass, t: Date.now(), worstMm: +(r.v.worst * MM).toFixed(2), status: r.v.status, code: r.code, ex: r.st.ex, ey: r.st.ey, psx: r.v.printScaleX, psy: r.v.printScaleY }]).slice(-20);
    saveCal(c); refresh(false); return c; }
  function choose(mode, useRuler) { const r = lastResult; if (!r) return;
    const k = mode === 'compensate' ? compFromResult(r, useRuler) : { ex: 1, ey: 1 };
    saveResult(r, { mode, ex: k.ex, ey: k.ey, status: 'verify' }); S.applyCorr = true; saveSettings(); window._rebind && window._rebind();
    $('#verdict').innerHTML = `<div class="vbox ok">Saved: ${mode === 'compensate' ? `print compensation <b>${fmtPct(k.ex - 1)}</b> across / <b>${fmtPct(k.ey - 1)}</b> down (true size); the cut file now only corrects rotation and shift.` : 'cuts follow your printer’s print (no print compensation); pieces print slightly small.'} Now do a verification pass with the steps above.</div>`;
    renderCalTable(); }
  function verdictHTML(r) { const core = verdictCore(r), v = r.v;
    if (v.status === 'incomplete' || v.status === 'bad-reading') return core + fixHTML(r);
    const notes = [];
    if (v.dropped) notes.push(`${v.dropped} was left out of this fit (4 targets used).`);
    else if (v.forced) notes.push('Saved using all 5 targets as entered.');
    if (v.noisy && !v.fix) notes.push(`Readings are a bit noisy (largest misfit ${(v.misMax * MM).toFixed(2)} mm). That's normal for reading by eye (about ±1 mm), and the fit uses all of them. The next pass will show whether it's real.`);
    return (notes.length ? `<div class="vbox">${notes.join(' ')}</div>` : '') + fixHTML(r) + core + (v.status === 'needs-choice' || v.offerChoice ? '' : rulerHTML(r)); }
  function fixHTML(r) { const f = r.v.fix; if (!f) return '';
    const cur = r.samples.find(q => q.id === f.id), what = f.kind === 'swap' ? 'X and Y were swapped' : f.kind === 'flipX' ? 'the X sign is flipped' : 'the Y sign is flipped';
    return `<div class="vbox warnbox">💡 <b>Looks like ${what} at ${f.id}?</b> You entered X ${(cur.rx * MM).toFixed(2)}, Y ${(cur.ry * MM).toFixed(2)}. With X ${(f.x * MM).toFixed(2)}, Y ${(f.y * MM).toFixed(2)} every target fits within ${(f.after * MM).toFixed(2)} mm (now ${(f.before * MM).toFixed(2)} mm). Check the sheet: X is read on the row across the square's <b>left</b> edge, Y on the column across its <b>top</b> edge.
      <button class="btn sec" id="applyFix">Use X ${(f.x * MM).toFixed(2)}, Y ${(f.y * MM).toFixed(2)} for ${f.id} and recompute</button></div>`; }
  function rulerHTML(r) { const ru = readRuler(), v = r.v; if (!isFinite(ru.x) && !isFinite(ru.y)) return '';
    const parts = [];
    if (isFinite(ru.x)) { const k = C.rulerShrink(ru.x, ru.ex, r.st.ex); parts.push(`across ${ru.x.toFixed(3)} of ${ru.ex.toFixed(3)} in → ${(k.shrink * 100).toFixed(2)}% short (readings say ${(v.shrinkX * 100).toFixed(2)}%)`); }
    if (isFinite(ru.y)) { const k = C.rulerShrink(ru.y, ru.ey, r.st.ey); parts.push(`down ${ru.y.toFixed(3)} of ${ru.ey.toFixed(3)} in → ${(k.shrink * 100).toFixed(2)}% short (readings say ${(v.shrinkY * 100).toFixed(2)}%)`); }
    return `<div class="muted">Ruler cross-check: ${parts.join('; ')}.</div>`; }
  function verdictCore(r) {
    const v = r.v, q = r.fit.q, ru = readRuler(), tolMm = (getCal().tol || 0.5 / MM) * MM, cutRot = -q.th * 180 / Math.PI;
    const worst = isFinite(v.worst) ? (v.worst * MM).toFixed(2) : '–', rows = [];
    const shrinkLine = `Your printer prints this sheet at <b>${(100 * (1 - v.shrinkX)).toFixed(2)}%</b> across and <b>${(100 * (1 - v.shrinkY)).toFixed(2)}%</b> down (it is ${v.shrinkX >= 0 ? 'shrinking' : 'enlarging'} the page by ${Math.abs(v.shrinkX * 100).toFixed(2)}% (X) / ${Math.abs(v.shrinkY * 100).toFixed(2)}% (Y)).`;
    let rulerLine = '';
    if (isFinite(ru.x) || isFinite(ru.y)) { const parts = [];
      if (isFinite(ru.x)) { const k = C.rulerShrink(ru.x, ru.ex, r.st.ex); parts.push(`across ${ru.x.toFixed(3)} in of ${ru.ex.toFixed(3)} → shrink ${(k.shrink * 100).toFixed(2)}%, needs ${fmtPct(k.comp)}${Math.abs(k.shrink - v.shrinkX) > 0.004 ? ' <span class="warn">(differs from the cut readings by more than 0.4% – re-measure outside-to-outside)</span>' : ' (agrees with the readings)'}`); }
      if (isFinite(ru.y)) { const k = C.rulerShrink(ru.y, ru.ey, r.st.ey); parts.push(`down ${ru.y.toFixed(3)} in of ${ru.ey.toFixed(3)} → shrink ${(k.shrink * 100).toFixed(2)}%, needs ${fmtPct(k.comp)}${Math.abs(k.shrink - v.shrinkY) > 0.004 ? ' <span class="warn">(differs from the readings by more than 0.4%)</span>' : ' (agrees)'}`); }
      rulerLine = `<div>Ruler check: ${parts.join('; ')}.</div>`; }
    const fitLine = `<div class="muted">Fit: cut vs print rotated ${Math.abs(cutRot).toFixed(2)}° ${cutRot >= 0 ? 'clockwise' : 'counter-clockwise'}, shifted ${mmTxt(-q.ux, 'right', 'left')} / ${mmTxt(-q.uy, 'down', 'up')} at the centre. Worst reading this pass ${worst} mm.</div>`;
    if (v.status === 'incomplete') return `<div class="vbox">Enter at least 4 of the 10 readings (ideally all 10), then Compute.</div>`;
    if (v.status === 'bad-reading') { const b = v.bad[0], lo = r.fit.loo.find(l => l.id === b), e = lo ? Math.max(Math.abs(lo.x || 0), Math.abs(lo.y || 0)) * MM : NaN;
      return `<div class="vbox bad"><b>⚠ ${b} doesn't fit the pattern of the other four</b>: predicted from them it should read about ${(e).toFixed(1)} mm differently, far more than the others disagree. Most likely a mis-read (X is on the left-edge row, Y on the top-edge column, + = right / lower) or a typo. Nothing is saved yet; choose:
        <p><button class="btn sec" id="reEnter">Re-enter ${b}</button> <button class="btn" data-drop="${b}">Drop ${b} and save (fit with 4 targets)</button> <button class="btn sec" id="useAnyway">Use anyway (all 5)</button></p></div>`; }
    if (v.stale) { const s2 = v.stale;
      return `<div class="vbox bad"><b>✗ This sheet (code ${s2.code}) was made ${s2.sheetHasComp ? `with print compensation ${fmtPct(s2.sheetEx - 1)} / ${fmtPct(s2.sheetEy - 1)}` : '<u>without</u> any print compensation or cut correction'}, not with your current calibration (${s2.curEx !== 1 || s2.curEy !== 1 ? `compensation ${fmtPct(s2.curEx - 1)} / ${fmtPct(s2.curEy - 1)}` : 'no compensation'}, files show code <b>${s2.curCode}</b>).</b>
        <p>So it can't verify the calibration${s2.sheetHasComp ? '' : ' – that is why the corner marks still measure short and the readings look like pass 1'}. Most likely the calibration PDF/SVG were downloaded before the choice was made (the earlier download has the same look; only the code differs).</p>
        <p><b>Next:</b> delete the older calibration files (and the old image in Design Space), click the download buttons in step 1 above, and check the new PDF's top line says <b>CODE ${s2.curCode} · COMPENSATION ${fmtPct(s2.curEx - 1)} / ${fmtPct(s2.curEy - 1)}</b> before printing. Nothing was saved from these readings.</p>${shrinkLine ? `<p class="muted">For reference, analysed as sheet ${s2.code}: ${shrinkLine}</p>` : ''}</div>`; }
    if (v.status === 'comp-not-applied') {
      const w = v.compWhy.map(x => x.ruler != null ? `${x.ax}: the ruler says the paper is ${(100 * (1 - x.ruler)).toFixed(2)}% short although this sheet is enlarged ${fmtPct(x.want)}` : `${x.ax}: compensation changed ${fmtPct(x.want)} since the previous pass, but the size on paper changed only ${fmtPct(x.got)}`).join('; ');
      return `<div class="vbox bad"><b>✗ The print compensation didn't reach the paper.</b> ${w}.
        <p>The print scale is unchanged from the previous pass even though the compensation changed. Either the new PDF wasn't the one printed (check the code and compensation line printed next to it), a different sheet code was picked in the dropdown, or the print path rescaled the content (Acrobat: Page Sizing must be <i>Actual size</i>, not Fit/Shrink; printer Properties: Reduce/Enlarge or Fit to Page off). Nothing was saved and the compensation was not changed (adjusting it now would just compound the error).</p>${fitLine}</div>`; }
    if (v.status === 'needs-choice' || v.offerChoice) {
      const k = compFromResult(r, false), kr = (isFinite(ru.x) || isFinite(ru.y)) ? compFromResult(r, true) : null;
      return `<div class="vbox warnbox"><b>⚠ ${shrinkLine}</b>${rulerLine}${fitLine}
        <p>Choose how to handle it:</p>
        <p><button class="btn" id="chooseComp">(a) Compensate for true size: enlarge the print ${fmtPct(k.ex - 1)} / ${fmtPct(k.ey - 1)}</button>
        ${kr ? ` <button class="btn sec" id="chooseCompRuler">(a′) Compensate using my ruler: ${fmtPct(kr.ex - 1)} / ${fmtPct(kr.ey - 1)}</button>` : ''}
        <button class="btn sec" id="chooseKeep">(b) Keep: cuts follow the print, pieces print ~${(100 * (v.shrinkX + v.shrinkY) / 2).toFixed(1)}% small</button></p>
        <p><b>Recommended: (a).</b> If your printer shrinks the page even at 100% / Actual size (Acrobat included), the shrink is in the printer driver. Compensating makes the pieces print at the size you set, and the cut file only has to fix rotation and shift. Either way you then do one verification pass.</p>
        <p class="muted">Optional check: in the printer's own Properties/Preferences (for example Printing Preferences → More Options → Reduce/Enlarge Document or “Fit to Page”, and Borderless) make sure fit-to-page/reduce is off and Borderless is off. If changing one of those removes the shrink, calibrate again from pass 1 instead.</p></div>`; }
    if (v.status === 'calibrated') return `<div class="vbox ok"><b>✓ Calibrated.</b> All ${v.n} readings are within ±${tolMm.toFixed(2)} mm (worst ${worst} mm). The refined fit was saved.${v.adjustComp ? `<div class="warn">Cuts match the print, but the print is still ${(v.trueSizeOff * 100).toFixed(2)}% off true size. <button class="btn sec" id="adjComp">Adjust compensation to ${fmtPct(v.compX)} / ${fmtPct(v.compY)}</button> (then one more pass).</div>` : ''}${fitLine}<p>You can now export real sheets from the Layout tab. Re-calibrate if you change printer, paper type, print settings or mat.</p></div>`;
    // retry
    const kinds = { offset: `mostly a <b>shift</b> (${v.components.offMm.toFixed(2)} mm): usually the paper wasn't exactly on the mat's 0,0 corner. A refined fit was saved, but if the shift is different every time, place the sheet more carefully (use a straightedge or tape a corner stop).`,
      rotation: `mostly a <b>rotation</b> (${v.components.rotMm.toFixed(2)} mm at the edges): the sheet sat slightly crooked on the mat. A refined fit was saved; line the top edge up with the grid line exactly.`,
      scale: `mostly a <b>size difference</b> (${v.components.scaleMm.toFixed(2)} mm at the edges). A refined fit was saved.${v.adjustComp ? ` The print is ${(v.trueSizeOff * 100).toFixed(2)}% off true size: <button class="btn sec" id="adjComp">adjust compensation to ${fmtPct(v.compX)} / ${fmtPct(v.compY)}</button>.` : ''}` };
    return `<div class="vbox bad"><b>Not within ±${tolMm.toFixed(2)} mm yet</b> (worst ${worst} mm). The remaining error is ${v.kinds.map(k => kinds[k]).join(' ')}${fitLine}<p>Next: do another pass with the steps above (new files include the refined fit).</p></div>`;
  }
  function onCompute(opts) { opts = opts || {};
    const code = $('#calCode').value, readings = readCalInputs(); if (opts.drop) readings[opts.drop] = { x: '', y: '' };
    const r = computeCalibration(readings, code, opts); lastResult = r;
    for (const q of r.fit.misfit) { const cell = $(`.res[data-t="${q.id}"]`); if (!cell) continue; const ex = q.x * MM, ey = q.y * MM, lo = r.fit.loo.find(l => l.id === q.id);
      const worst = Math.max(isFinite(ex) ? Math.abs(ex) : 0, isFinite(ey) ? Math.abs(ey) : 0);
      cell.textContent = `${isFinite(ex) ? ex.toFixed(2) : '–'} / ${isFinite(ey) ? ey.toFixed(2) : '–'}`; cell.className = 'res' + (worst > 1 || r.v.bad.includes(q.id) ? ' badres' : ''); void lo; }
    const v = r.v;
    if (v.stale) { /* nothing saved: this sheet doesn't test the current calibration */ }
    else if (v.status === 'calibrated') saveResult(r, { status: 'calibrated' });
    else if (v.status === 'retry') saveResult(r, { status: 'verify' });
    const over = overRange(readings);
    $('#verdict').innerHTML = (over.length ? `<div class="vbox warnbox">⚠ ${over.join(', ')} ${over.length > 1 ? 'are' : 'is'} beyond the ±${SCALE_MM} mm printed scale. The cut slit can't cross the scale there, so the number is a guess – it was used as typed. Measure it with a ruler from the printed edge if you can; after this pass's correction the next sheet will be well inside the scale.</div>` : '') + verdictHTML(r);
    const bind = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
    bind('useAnyway', () => onCompute({ ignoreBad: true })); $$('#verdict [data-drop]').forEach(b => b.onclick = () => onCompute({ drop: b.dataset.drop, ignoreBad: true }));
    bind('reEnter', () => { const i = $(`#caltable input[data-t="${r.v.bad[0]}"]`); if (i) { i.focus(); i.select(); } });
    bind('applyFix', () => { const f = r.v.fix; const ix = $(`#caltable input[data-t="${f.id}"][data-a="x"]`), iy = $(`#caltable input[data-t="${f.id}"][data-a="y"]`);
      ix.value = +(f.x * MM).toFixed(2); iy.value = +(f.y * MM).toFixed(2); saveDraft(); onCompute(); });
    bind('chooseComp', () => choose('compensate', false)); bind('chooseCompRuler', () => choose('compensate', true)); bind('chooseKeep', () => choose('keep', false));
    bind('adjComp', () => { const c = getCal(); c.ex = 1 / r.fit.q.qx; c.ey = 1 / r.fit.q.qy; c.mode = 'compensate'; c.status = 'verify'; saveCal(c); refresh(false); renderCalTable(); $('#verdict').innerHTML += '<div class="vbox ok">Compensation adjusted. Do one more pass with the new files.</div>'; });
    renderWizard(); $('#corrNow').innerHTML = `Saved for ${calKey().replace(/^cst\.cal\./, '')}: ${corrWords()}.`; $('#calLoaded').innerHTML = calStatusLine(); saveDraft(); return r;
  }
  function renderWizard() {
    const c = getCal(), st = currentState(), code = stateCode(st), sh = sheetDims(), bw = sh.w - 2 * S.inset, bh = sh.h - 2 * S.inset, next = (c.pass || 0) + 1;
    const modeTxt = c.mode === 'compensate' ? `True size (print compensation ${fmtPct(c.ex - 1)} / ${fmtPct(c.ey - 1)})` : c.mode === 'keep' ? 'Cuts follow the print (no compensation)' : 'not chosen yet';
    const done = c.status === 'calibrated';
    const steps = [
      `Download the new <button class="btn sec" data-dl="pdf">⬇ Calibration print PDF</button> and <button class="btn sec" data-dl="svg">⬇ Calibration cut SVG</button>. They show sheet code <b>${code}</b>.`,
      `Design Space: ${c.pass ? '<b>delete the old calibration image</b>, then ' : ''}upload the new SVG and add it to the canvas. Check its size reads <b>${bw.toFixed(3)} × ${bh.toFixed(3)} in</b>, then Make → On Mat. Don't move it.`,
      `Print the PDF at <b>100% / Custom 100</b> with the same printer settings as before.${c.mode === 'compensate' ? ` With a ruler the corner marks should now measure <b>${bw.toFixed(3)} × ${bh.toFixed(3)} in</b>; type what you measure in the ruler boxes.` : ' Optional: measure the corner marks with a ruler (outside to outside) and type it below.'}`,
      `Put the sheet's top-left corner exactly on the mat's 0,0 grid corner, cut with a light setting (e.g. Copy Paper), and leave the paper on the mat.`,
      `Read the 10 numbers into the table below, check the sheet code says <b>${code}</b>, and click <b>Compute</b>.`];
    $('#wizard').innerHTML = `<div class="wizhead"><span class="passbadge">${done ? '✓ Calibrated' : 'Pass ' + next}</span> <span>Mode: <b>${modeTxt}</b></span> <span class="muted">${(c.history || []).slice(-4).map(h => `pass ${h.pass}: ${h.status} (${h.worstMm} mm)`).join(' · ')}</span></div>
      ${done ? `<p>Calibrated on pass ${c.pass}. Export real sheets from the Layout tab. To check again later, repeat these steps:</p>` : `<p>${c.pass ? 'Verification pass: the new files include everything learned so far.' : 'First pass: files without any correction.'}</p>`}
      ${Object.values(c.issued || {}).some(x => (x.layout || 1) < CAL_LAYOUT) && Object.values(c.issued || {}).every(x => (x.layout || 1) < CAL_LAYOUT) ? `<p class="muted">The calibration sheet layout changed (bigger targets, ±${SCALE_MM} mm scales). Your saved calibration${(c.ex || 1) !== 1 || (c.ey || 1) !== 1 ? ` and print compensation ${fmtPct(c.ex - 1)} / ${fmtPct(c.ey - 1)}` : ''} are kept; sheets you already printed are still read with their old geometry, and the next sheet uses the new one (new code ${code}).</p>` : ''}
      ${c.mode && !done ? (() => { const old = Object.keys(c.issued || {}).filter(k => k !== code); const cmp = st.ex !== 1 || st.ey !== 1;
        return `<p class="warn">Use only files with sheet code <b>${code}</b>${cmp ? ` – their PDF's top line says “CODE ${code} · COMPENSATION ${fmtPct(st.ex - 1)} / ${fmtPct(st.ey - 1)}” and its corner marks are ${(bw * st.ex).toFixed(3)} × ${(bh * st.ey).toFixed(3)} in inside the PDF` : ''}.${old.length ? ` Files with ${old.join(', ')} are out of date – delete them.` : ''}${S.applyCorr ? '' : ' <b>Note: “Apply calibration” is OFF on the Layout tab, so your real sheets are not corrected (calibration files always are).</b>'}</p>`; })() : ''}
      <ol class="wsteps">${steps.map(t => `<li>${t}</li>`).join('')}</ol>`;
    $$('#wizard [data-dl]').forEach(b => b.onclick = () => { b.dataset.dl === 'pdf' ? saveBlob(`${base()}-CALIBRATION-${code}-PRINT.pdf`, buildCalPDF().output('blob')) : saveBlob(`${base()}-CALIBRATION-${code}-CUT.svg`, buildCalSVG(), 'image/svg+xml'); setTimeout(renderCalTable, 50); });
  }
  // ---------- preview ----------
  let view = { sc: 50 }, sel = { key: null, itemId: null }, drag = null, filterText = '';
  function drawPreview(canvas, opts) {
    const L = layout || computeLayout(), sh = L.sh, o = Object.assign({ print: true, cut: true, anchors: true, scale: null, ui: false }, opts || {});
    const box = canvas.parentElement, fit = Math.max(10, Math.min((box.clientWidth - 20) / sh.w, ((window.innerHeight - 170) || 600) / sh.h));
    const sc = o.scale || fit * (o.ui ? (S.zoom || 1) : 1);
    if (o.ui) view = { sc };
    canvas.width = Math.round(sh.w * sc); canvas.height = Math.round(sh.h * sc);
    const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = '#e4e8ee'; g.lineWidth = 1; g.setLineDash([4, 4]); g.strokeRect(L.m.l * sc, L.m.t * sc, L.uw * sc, L.uh * sc); g.setLineDash([]);
    const pl0 = L.sheets[curSheet] || [], pl = o.ui && sel.key ? pl0.filter(e => e.key !== sel.key).concat(pl0.filter(e => e.key === sel.key)) : pl0; // selected piece on top (screen only)
    if (o.print) for (const e of pl) { const pr = e.p.print; g.drawImage(pr.canvas, (e.x + pr.x) * sc, (e.y + pr.y) * sc, pr.w * sc, pr.h * sc); }
    if (o.print && S.numberPieces) { g.save(); g.font = `${Math.max(7, 0.062 * sc)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const lb of pieceLabels(pl0, sh)) { g.fillStyle = '#fff'; g.strokeStyle = '#999'; g.lineWidth = 1; g.fillRect(lb.x * sc, lb.y * sc, lb.w * sc, lb.h * sc); g.strokeRect(lb.x * sc, lb.y * sc, lb.w * sc, lb.h * sc); g.fillStyle = lb.inside ? '#b3261e' : '#333'; g.fillText(lb.t, (lb.x + lb.w / 2) * sc, (lb.y + lb.h / 2) * sc); }
      g.restore(); }
    if (o.cut) { g.strokeStyle = '#e0115f'; g.lineWidth = Math.max(1, sc / 96); const loops = sheetCutLoops(pl, sh);
      for (const l of loops) { g.beginPath(); for (const s of l) { if (s[0] === 'M') g.moveTo(s[1] * sc, s[2] * sc); else if (s[0] === 'L') g.lineTo(s[1] * sc, s[2] * sc); else if (s[0] === 'C') g.bezierCurveTo(s[1] * sc, s[2] * sc, s[3] * sc, s[4] * sc, s[5] * sc, s[6] * sc); else g.closePath(); } g.stroke(); } }
    if (o.anchors) { const a = S.inset; g.strokeStyle = '#1f6feb'; g.setLineDash([6, 4]); g.lineWidth = 1; g.strokeRect(a * sc, a * sc, (sh.w - 2 * a) * sc, (sh.h - 2 * a) * sc); g.setLineDash([]);
      if (S.anchor === 'dots') { g.fillStyle = '#1f6feb'; for (const [x, y] of [[a, a], [sh.w - a - 0.04, a], [a, sh.h - a - 0.04], [sh.w - a - 0.04, sh.h - a - 0.04]]) g.fillRect(x * sc, y * sc, Math.max(3, 0.04 * sc), Math.max(3, 0.04 * sc)); } }
    if (o.ui) for (const e of pl) { // selection / drag feedback (screen only, never exported)
      const r = rectOf(e), on = e.key === sel.key, mine = sel.itemId != null && e.it.id === sel.itemId, bad = drag && drag.e === e && drag.moved && !drag.ok;
      if (!on && !mine && !bad) continue;
      g.save(); g.lineWidth = on || bad ? 2.5 : 1.5; g.strokeStyle = bad ? '#d93025' : '#1f6feb'; if (!on && !bad) g.setLineDash([5, 3]);
      g.fillStyle = bad ? 'rgba(217,48,37,.15)' : on ? 'rgba(31,111,235,.12)' : 'rgba(31,111,235,.05)';
      g.fillRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc); g.strokeRect(r.x * sc - 2, r.y * sc - 2, r.w * sc + 4, r.h * sc + 4); g.restore(); }
  }

  // ---------- UI ----------
  function numInput(val, onch, step) { const i = document.createElement('input'); i.type = 'number'; i.step = step || 'any'; i.value = val; i.addEventListener('change', () => { const v = parseFloat(i.value); if (isFinite(v)) onch(v); }); return i; }
  function tooBig(p, it) { const L = layout; if (!L) return false; const uw = L.uw + 1e-9, uh = L.uh + 1e-9;
    return !((p.cutW <= uw && p.cutH <= uh) || (S.rotate && it.rotate && p.cutH <= uw && p.cutW <= uh)); }
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  function placedCount(it) { return layout ? layout.sheets.reduce((t, s) => t + s.filter(e => e.it === it).length, 0) : 0; }
  function cardSummary(it) { const n = placedCount(it); return `${fmtShort(it.wIn)} × ${fmtShort(it.hIn)} · ×${it.qty}${n < it.qty ? ` <span class="warn">(${n} placed)</span>` : ''}`; }
  function renderItems() {
    const list = $('#items'); list.innerHTML = '';
    if (!items.length) list.innerHTML = '<div class="empty">No images yet. Drop PNG / JPG / SVG files above.</div>';
    for (const it of items) {
      if (it.lockAR == null) it.lockAR = true;
      const card = document.createElement('div'); card.className = 'item' + (it.collapsed ? ' collapsed' : '') + (sel.itemId === it.id ? ' sel' : ''); card.dataset.id = it.id;
      const p = processed(it, false);
      card.innerHTML = `<div class="ihead"><img src="${it.dataURL}" alt=""><div class="ititle"><div class="inrow"><span class="inum" data-iid="${it.id}"></span><div class="iname" title="${esc(it.name)}">${esc(it.name)}</div></div><div class="isum">${cardSummary(it)}</div></div><button class="x" title="Remove this image">✕</button><button class="chev" title="${it.collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!it.collapsed}">▾</button></div>
        <div class="ibody"><div class="grid">
          <label>Width (${S.unit})<span class="wrow"><span data-f="w"></span><button type="button" class="link${it.lockAR ? ' on' : ''}" title="${it.lockAR ? 'Aspect ratio locked: width and height change together. Click to unlink.' : 'Aspect ratio unlocked: width and height change separately. Click to link.'}">${it.lockAR ? '🔗' : '⛓︎‍💥'}</button></span></label><label>Height (${S.unit})<span data-f="h"></span></label><label>Qty<span class="qrow"><span data-f="q"></span><button type="button" class="pp fill" title="Raise the quantity until the current sheet(s) are full">Fill</button></span></label>
          <label>Scale % <span class="hint">100% = original size (${it.isSvg ? 'SVG\'s own size' : 'image pixels at ' + BASE_DPI + ' dpi'}: ${fmtLen(it.baseWIn)} wide)</span><span class="pctrow"><span data-f="pct"></span>${[25, 50, 75, 100].map(v => `<button type="button" class="pp" data-p="${v}">${v}%</button>`).join('')}</span></label>
          <label>Cut shape<select data-f="shape"><option value="rect">Rectangle</option><option value="rounded">Rounded rect</option><option value="contour"${it.hasAlpha ? '' : ' disabled'}>Contour (transparent PNG/SVG)</option></select></label>
          <label class="rad">Corner radius (${S.unit})<span data-f="r"></span></label>
          <label>Cut offset / white border (${S.unit})<span data-f="o"></span></label>
          <label>Bleed fill<select data-f="border"><option value="extend">Extend edge colours</option><option value="white">White border</option></select></label>
          <label class="chk"><input type="checkbox" data-f="rot"> Allow 90° rotation</label>
        </div><div class="imeta">Cut size ${fmtLen(p.cutW)} × ${fmtLen(p.cutH)}${p.info.components > 1 ? ` · ${p.info.components} separate outlines` : ''}${tooBig(p, it) ? ` <span class="warn">· too large for the usable area – it is skipped; lower the size or %</span>` : ''}</div></div>`;
      if (isWarped(it)) { const wl = document.createElement('div'); wl.className = 'warpline'; wl.innerHTML = 'Warped in the Mockup (skew / distort): prints and cuts warped; the size above is before the warp. <button type="button" class="mini unwarp">Remove warp</button>'; $('.imeta', card).after(wl);
        $('.unwarp', wl).onclick = (ev) => { ev.stopPropagation(); it.warp = null; for (const n of MK.nodes) if (nodeItem(n) === it) n.warp = null; mkCommit(); refresh(true); }; }
      const ratio = () => it.hIn / it.wIn;
      $('[data-f=w]', card).append(numInput(toU(it.wIn), v => { const k = ratio(); it.wIn = Math.max(0.1, fromU(v)); if (it.lockAR) it.hIn = it.wIn * k; it.pct = pctOf(it); refresh(true); }));
      $('[data-f=h]', card).append(numInput(toU(it.hIn), v => { const k = ratio(); it.hIn = Math.max(0.1, fromU(v)); if (it.lockAR) it.wIn = it.hIn / k; it.pct = pctOf(it); refresh(true); }));
      $('.link', card).onclick = () => { it.lockAR = !it.lockAR; if (it.lockAR) { /* re-linking keeps the current ratio */ } refresh(true); };
      $('[data-f=pct]', card).append(numInput(+pctOf(it).toFixed(1), v => { if (v > 0) { setPct(it, v); refresh(true); } }, 1));
      $$('.pp[data-p]', card).forEach(b => b.onclick = () => { setPct(it, +b.dataset.p); refresh(true); });
      $('[data-f=q]', card).append(numInput(it.qty, v => { it.qty = Math.max(0, Math.round(v)); refresh(true); }, 1));
      $('.fill', card).onclick = () => fillQty(it);
      $('[data-f=r]', card).append(numInput(toU(it.radiusIn), v => { it.radiusIn = Math.max(0, fromU(v)); refresh(true); }));
      $('[data-f=o]', card).append(numInput(toU(it.offsetIn), v => { it.offsetIn = Math.max(0, fromU(v)); refresh(true); }));
      const ss = $('[data-f=shape]', card); ss.value = it.shape; ss.onchange = () => { it.shape = ss.value; refresh(true); };
      $('.rad', card).style.display = it.shape === 'rounded' ? '' : 'none';
      const bs = $('[data-f=border]', card); bs.value = it.border; bs.onchange = () => { it.border = bs.value; refresh(true); };
      const rc = $('[data-f=rot]', card); rc.checked = it.rotate; rc.onchange = () => { it.rotate = rc.checked; refresh(true); };
      $('.x', card).onclick = (ev) => { ev.stopPropagation(); items = items.filter(i => i !== it); if (sel.itemId === it.id) sel = { key: null, itemId: null }; refresh(true); };
      $('.chev', card).onclick = (ev) => { ev.stopPropagation(); setCollapsed(it, card, !it.collapsed); };
      $('.ihead', card).onclick = (ev) => { if (ev.target.closest('button')) return; selectItem(it); };
      list.append(card);
    }
    applyFilter(); renderImgSummary(); mkCardNums();
  }
  function setCollapsed(it, card, v) { it.collapsed = v; card = card || cardOf(it); if (!card) return; card.classList.toggle('collapsed', v); const b = $('.chev', card); b.title = v ? 'Expand' : 'Collapse'; b.setAttribute('aria-expanded', String(!v)); }
  const cardOf = (it) => $(`#items .item[data-id="${it.id}"]`);
  function applyFilter() { const q = filterText.trim().toLowerCase(); let shown = 0;
    $$('#items .item').forEach(c => { const it = items.find(i => String(i.id) === c.dataset.id), vis = !q || (it && it.name.toLowerCase().includes(q)); c.style.display = vis ? '' : 'none'; if (vis) shown++; });
    const n = $('#filterNote'); if (n) n.textContent = q ? `${shown} of ${items.length} shown` : ''; }
  function renderImgSummary() { const L = layout, el = $('#imgSummary'); if (!el || !L) return; const n = L.sheets.reduce((t, s) => t + s.length, 0), want = items.reduce((t, i) => t + i.qty, 0);
    el.textContent = items.length ? `${items.length} image${items.length === 1 ? '' : 's'} · ${n}${want > n ? '/' + want : ''} piece${want === 1 ? '' : 's'} · ${L.sheets.length} sheet${L.sheets.length === 1 ? '' : 's'}` : '';
    $('#imgTools').style.display = items.length ? '' : 'none'; }
  function refreshCardSummaries() { for (const it of items) { const c = cardOf(it); if (c) $('.isum', c).innerHTML = cardSummary(it); } renderImgSummary(); mkCardNums(); }
  function highlightCards() { $$('#items .item').forEach(c => c.classList.toggle('sel', sel.itemId != null && c.dataset.id === String(sel.itemId))); }
  function selectItem(it) { sel = { key: null, itemId: it ? it.id : null }; highlightCards();
    if (it && layout) { const onCur = (layout.sheets[curSheet] || []).some(e => e.it === it); if (!onCur) { const si = layout.sheets.findIndex(s => s.some(e => e.it === it)); if (si >= 0) { curSheet = si; renderStatus(); } } }
    renderPreview(); renderSelBar(); }
  function selectPiece(e) { sel = e ? { key: e.key, itemId: e.it.id } : { key: null, itemId: null }; highlightCards();
    if (e) { const c = cardOf(e.it); if (c) { if (e.it.collapsed) setCollapsed(e.it, c, false); if (filterText && c.style.display === 'none') { filterText = ''; $('#ifilter').value = ''; applyFilter(); } c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
    renderPreview(); renderSelBar(); }
  const selEntry = () => { if (!sel.key || !layout) return null; for (const s of layout.sheets) for (const e of s) if (e.key === sel.key) return e; return null; };
  function renderSelBar() { const bar = $('#selbar'); if (!bar) return; const e = selEntry();
    bar.classList.toggle('idle', !e); $$('button', bar).forEach(b => b.disabled = !e);
    if (!e) { $('#selName').textContent = layout && layout.sheets.flat().length ? 'Click a piece to select it · drag to move · arrows nudge · R rotate · D duplicate · Del delete · Ctrl+Z undo' : 'Add images to start'; return; }
    $('#selName').textContent = `${e.it.name} · copy ${+e.key.split('#')[1] + 1} of ${e.it.qty} · at ${fmtShort(e.x)}, ${fmtShort(e.y)}${e.rot ? ' · rotated' : ''}`;
    $('#selPrev').disabled = curSheet === 0; }
  function renderStatus() {
    $('#customRow') && ($('#customRow').querySelectorAll('label')[0].style.display = $('#customRow').querySelectorAll('label')[1].style.display = S.sheet === 'custom' ? '' : 'none');
    const L = layout, sh = L.sh, n = L.sheets.reduce((t, s) => t + s.length, 0), comp = activeComp(), cal = getCal(), calOn = S.applyCorr && (cal.status === 'calibrated' || cal.status === 'verify' || comp.ex !== 1 || comp.ey !== 1);
    // full details live in the popover (and on the Calibrate tab); the stage only shows chips + one-line safety warnings
    $('#status').innerHTML = `<b>${n} piece${n === 1 ? '' : 's'} on ${L.sheets.length} sheet${L.sheets.length === 1 ? '' : 's'}</b>${L.manual ? ' (hand-placed layout)' : ' (auto-packed)'} · usable ${fmtLen(L.uw)} × ${fmtLen(L.uh)} · mat ${L.mi.ok ? L.mi.mat : '—'} · cut file ${fmtLen(sh.w - 2 * S.inset)} × ${fmtLen(sh.h - 2 * S.inset)}`
      + `<div class="muted" style="margin-top:6px">Calibration ${S.applyCorr ? 'ON' : 'OFF'}: ${corrWords()}</div><div class="muted">${calStatusLine()}</div>`
      + L.info.map(w => `<div class="muted" style="margin-top:6px">ℹ ${w}</div>`).join('') + L.warn.map(w => `<div class="warn">⚠ ${w}</div>`).join('');
    $('#chipCount').textContent = `${n} piece${n === 1 ? '' : 's'} · ${L.sheets.length} sheet${L.sheets.length === 1 ? '' : 's'}`;
    const cc = $('#chipCal'); cc.className = 'chip ' + (calOn ? 'ok' : 'off');
    cc.textContent = S.applyCorr ? (comp.ex !== 1 || comp.ey !== 1 ? `✓ Calibrated · print +${((comp.ex - 1) * 100).toFixed(2)}% / +${((comp.ey - 1) * 100).toFixed(2)}%` : calOn ? '✓ Calibration on' : 'Not calibrated yet') : 'Calibration off';
    $('#chipManual').style.display = L.manual ? '' : 'none';
    const wl = $('#warnline'); wl.innerHTML = L.warn.map(w => `<div class="warn" title="${esc(w)}">⚠ ${w}</div>`).join(''); wl.style.display = L.warn.length ? '' : 'none';
    const tabs = $('#sheettabs'); tabs.innerHTML = '';
    L.sheets.forEach((_, i) => { const b = document.createElement('button'); b.textContent = 'Sheet ' + (i + 1); b.className = i === curSheet ? 'on' : ''; b.onclick = () => { curSheet = i; renderPreview(); renderStatus(); }; tabs.append(b); });
    $$('.ds-size').forEach(e => e.textContent = `${(sh.w - 2 * S.inset).toFixed(3)} in × ${(sh.h - 2 * S.inset).toFixed(3)} in`);
    $$('.mat-size').forEach(e => e.textContent = L.mi.ok ? L.mi.mat : 'n/a');
    $('#zoomPct').textContent = Math.round((S.zoom || 1) * 100) + '%';
    $('#undoBtn').disabled = !undoStack.length; $('#redoBtn').disabled = !redoStack.length;
    renderSelBar(); renderImgSummary(); window._sheetSum && window._sheetSum();
  }
  function renderPreview() { const cv = $('#preview'); drawPreview(cv, { print: $('#showPrint').checked, cut: $('#showCut').checked, anchors: $('#showAnchors').checked, ui: true }); cv.style.maxWidth = (S.zoom || 1) > 1 ? 'none' : '100%'; }

  // ---------- undo / redo (item sizes, quantities, options and piece positions) ----------
  const UNDO_FIELDS = ['wIn', 'hIn', 'pct', 'qty', 'shape', 'radiusIn', 'offsetIn', 'border', 'rotate', 'lockAR'];
  let undoStack = [], redoStack = [], curSnap = null, follow = null;
  function snapshot() { const its = items.map(it => [it, Object.fromEntries(UNDO_FIELDS.map(f => [f, it[f]]))]), man = manual ? JSON.parse(JSON.stringify(manual)) : null;
    return { its, man, sig: JSON.stringify([its.map(([it, f]) => [it.id, f]), man]) }; }
  function recordUndo() { const s = snapshot(); if (curSnap && s.sig === curSnap.sig) return; if (curSnap) { undoStack.push(curSnap); if (undoStack.length > 100) undoStack.shift(); redoStack = []; } curSnap = s; }
  function applySnap(s) { items = s.its.map(([it, f]) => Object.assign(it, f)); manual = s.man ? JSON.parse(JSON.stringify(s.man)) : null; curSnap = s; refresh(true); }
  function undo() { if (!undoStack.length) return; redoStack.push(curSnap); applySnap(undoStack.pop()); toast('Undone'); }
  function redo() { if (!redoStack.length) return; undoStack.push(curSnap); applySnap(redoStack.pop()); toast('Redone'); }

  function refresh(itemsChanged) { mkIdbSoon();
    clearTimeout(dirtyTimer); $('#busy').style.display = '';
    dirtyTimer = setTimeout(() => { try { syncItemWarps(); computeLayout(); recordUndo();
      if (follow) { const i = layout.sheets.findIndex(s => s.some(e => e.key === follow.key)); if (i >= 0) { curSheet = i; toast(follow.msg + (i + 1)); } follow = null; }
      if (itemsChanged !== false) renderItems(); else refreshCardSummaries(); renderStatus(); renderPreview(); if ($('#tabMock').style.display !== 'none') renderMock(); } catch (e) { console.error(e); alert('Error: ' + e.message); } $('#busy').style.display = 'none'; if (window.CST && window.CST.bus) window.CST.bus.emit('items:changed'); }, 30);
  }
  let toastT = null;
  function toast(msg, bad) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 2600); }

  // ---------- interactive canvas ----------
  /** switch to hand placement, keeping every piece where it is now */
  function pinLayout() { const L = layout || computeLayout(); let o = 0; manual = { pieces: {} }; L.sheets.forEach((l, si) => l.forEach(e => { manual.pieces[e.key] = { s: si, x: e.x, y: e.y, rot: !!e.rot, o: o++ }; })); }
  function resetAuto() { if (!manual) { toast('Already auto-packed'); return; } manual = null; sel.key = null; refresh(false); toast('Back to auto-pack'); }
  function canvasPt(ev) { const c = $('#preview'), r = c.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (c.width / r.width) / view.sc, y: (ev.clientY - r.top) * (c.height / r.height) / view.sc }; }
  function hitTest(pt) { const pl = (layout && layout.sheets[curSheet]) || []; for (let i = pl.length - 1; i >= 0; i--) { const e = pl[i]; if (pt.x >= e.x && pt.x <= e.x + e.p.cutW && pt.y >= e.y && pt.y <= e.y + e.p.cutH) return e; } return null; }
  function snapRect(r, list, B, sp, thr, skip) {
    const xs = [B.x0, B.x1 - r.w], ys = [B.y0, B.y1 - r.h];
    for (const e of list) { if (e === skip) continue; const o = rectOf(e); xs.push(o.x + o.w + sp, o.x - sp - r.w, o.x, o.x + o.w - r.w); ys.push(o.y + o.h + sp, o.y - sp - r.h, o.y, o.y + o.h - r.h); }
    const near = (arr, v) => arr.filter(a => Math.abs(a - v) < thr).sort((a, b) => Math.abs(a - v) - Math.abs(b - v));
    const free = (x, y) => { const q = { x, y, w: r.w, h: r.h }; return fitsIn(q, B) && freeAt(list, q, sp, skip); };
    const cx = near(xs, r.x).filter(x => x >= B.x0 - 1e-9 && x + r.w <= B.x1 + 1e-9), cy = near(ys, r.y).filter(y => y >= B.y0 - 1e-9 && y + r.h <= B.y1 + 1e-9);
    const rawFree = free(r.x, r.y);
    const tries = []; for (const x of cx) for (const y of cy) tries.push([x, y]); for (const x of cx) tries.push([x, r.y]); for (const y of cy) tries.push([r.x, y]);
    for (const [x, y] of tries) if (!rawFree || free(x, y)) { r.x = x; r.y = y; break; }
    return clampTo(r, B); }
  let rafPending = false; const redraw = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; renderPreview(); }); };
  function bindCanvas() {
    const cv = $('#preview');
    cv.addEventListener('pointerdown', ev => { if (ev.button > 0) return; const pt = canvasPt(ev), e = hitTest(pt); cv.focus({ preventScroll: true });
      if (!e) { selectPiece(null); return; }
      selectPiece(e); drag = { e, dx: pt.x - e.x, dy: pt.y - e.y, x0: e.x, y0: e.y, moved: false, ok: true, sx: ev.clientX, sy: ev.clientY };
      try { cv.setPointerCapture(ev.pointerId); } catch (er) { /* synthetic */ } ev.preventDefault(); });
    cv.addEventListener('pointermove', ev => {
      if (!drag) { const e = hitTest(canvasPt(ev)); cv.style.cursor = e ? 'grab' : 'default'; return; }
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
      drag.moved = true; cv.style.cursor = 'grabbing';
      const pt = canvasPt(ev), L = layout, B = boundsOf(L), list = L.sheets[curSheet], e = drag.e;
      const r = snapRect(clampTo({ x: pt.x - drag.dx, y: pt.y - drag.dy, w: e.p.cutW, h: e.p.cutH }, B), list, B, S.spacing, 7 / view.sc, e);
      e.x = r.x; e.y = r.y; drag.ok = freeAt(list, r, S.spacing, e); redraw(); });
    const end = () => { if (!drag) return; const d = drag; drag = null; cv.style.cursor = 'default'; if (!d.moved) { renderPreview(); return; }
      const L = layout, B = boundsOf(L), list = L.sheets[curSheet], e = d.e;
      if (!d.ok) { const n = findSpot(list, e.p.cutW, e.p.cutH, B, S.spacing, { x: e.x, y: e.y, r: 1 }, e);
        if (n) { e.x = n.x; e.y = n.y; toast(`Too close to another piece – nudged to the nearest spot with ${fmtLen(S.spacing)} spacing`); }
        else { e.x = d.x0; e.y = d.y0; toast('That spot overlaps other pieces – moved back', true); } }
      pinLayout(); refresh(false); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', ev => { if (!ev.ctrlKey) return; ev.preventDefault(); setZoom((S.zoom || 1) * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    document.addEventListener('keydown', ev => {
      if ($('#tabLayout').style.display === 'none') return;
      const tg = ev.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && !typing && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if (mod && !typing && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
      if (typing || mod) return; const e = selEntry();
      if (ev.key === 'Escape') { selectPiece(null); return; }
      if (!e) return;
      const st = (S.unit === 'mm' ? 1 / 25.4 : 1 / 16) * (ev.shiftKey ? 4 : 1);
      const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[ev.key];
      if (k) { ev.preventDefault(); nudge(e, k[0], k[1]); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deletePiece(e); }
      else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); rotatePiece(e); }
      else if (ev.key === 'd' || ev.key === 'D') { ev.preventDefault(); duplicatePiece(e); } });
    $('#selRot').onclick = () => { const e = selEntry(); e && rotatePiece(e); };
    $('#selDup').onclick = () => { const e = selEntry(); e && duplicatePiece(e); };
    $('#selDel').onclick = () => { const e = selEntry(); e && deletePiece(e); };
    $('#selPrev').onclick = () => { const e = selEntry(); e && moveToSheet(e, curSheet - 1); };
    $('#selNext').onclick = () => { const e = selEntry(); e && moveToSheet(e, curSheet + 1); };
    $('#resetAuto').onclick = resetAuto; $('#chipManual').onclick = resetAuto;
    $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
    $('#zoomIn').onclick = () => setZoom((S.zoom || 1) * 1.25); $('#zoomOut').onclick = () => setZoom((S.zoom || 1) / 1.25); $('#zoomFit').onclick = () => setZoom(1);
    const pop = $('#statusPop');
    $$('#chips .chip').forEach(c => { if (c.id !== 'chipManual') c.onclick = (ev) => { ev.stopPropagation(); pop.hidden = !pop.hidden; }; });
    document.addEventListener('click', ev => { if (!pop.hidden && !pop.contains(ev.target)) pop.hidden = true; });
  }
  function sheetSummary() { const sh = sheetDims(); return `${S.sheet === 'custom' ? 'Custom' : ({ letter: 'Letter', a4: 'A4', legal: 'Legal', sq12: '12×12' })[S.sheet] || S.sheet} ${fmtShort(sh.w)} × ${fmtShort(sh.h)} · margin ${fmtLen(S.margin)} · spacing ${fmtLen(S.spacing)}`; }
  function setZoom(z) { S.zoom = Math.max(0.5, Math.min(4, z)); if (Math.abs(S.zoom - 1) < 0.03) S.zoom = 1; saveSettings(); renderPreview(); $('#zoomPct').textContent = Math.round(S.zoom * 100) + '%'; }
  function placeOn(si, e, p, near) { const L = layout, B = boundsOf(L), list = (L.sheets[si] || []).filter(x => x !== e);
    return findSpot(list, p.cutW, p.cutH, B, S.spacing, near, null) || (near ? findSpot(list, p.cutW, p.cutH, B, S.spacing, null, null) : null); }
  function nudge(e, dx, dy) { const L = layout, B = boundsOf(L), list = L.sheets[curSheet], r = clampTo({ x: e.x + dx, y: e.y + dy, w: e.p.cutW, h: e.p.cutH }, B);
    if (Math.abs(r.x - e.x) < 1e-9 && Math.abs(r.y - e.y) < 1e-9) { toast('At the edge of the usable area'); return; }
    if (!freeAt(list, r, S.spacing, e)) { toast(`Blocked: would be closer than ${fmtLen(S.spacing)} to another piece`, true); return; }
    e.x = r.x; e.y = r.y; pinLayout(); refresh(false); }
  function rotatePiece(e) { const p = processed(e.it, !e.rot), cx = e.x + e.p.cutW / 2, cy = e.y + e.p.cutH / 2, L = layout, B = boundsOf(L);
    if (p.cutW > L.uw + 1e-9 || p.cutH > L.uh + 1e-9) { toast('Rotated it would not fit in the usable area', true); return; }
    const r = clampTo({ x: cx - p.cutW / 2, y: cy - p.cutH / 2, w: p.cutW, h: p.cutH }, B), list = L.sheets[curSheet];
    let spot = freeAt(list, r, S.spacing, e) ? r : placeOn(curSheet, e, p, { x: r.x, y: r.y, r: 2 }), si = curSheet;
    if (!spot) { toast('No room to rotate it here', true); return; }
    pinLayout(); manual.pieces[e.key] = { s: si, x: spot.x, y: spot.y, rot: !e.rot }; refresh(false); }
  function moveToSheet(e, si) { if (si < 0) return; const L = layout, p = e.p, n = si >= L.sheets.length ? 'new' : null;
    const spot = n ? clampTo({ x: e.x, y: e.y, w: p.cutW, h: p.cutH }, boundsOf(L)) : placeOn(si, e, p, { x: e.x, y: e.y, r: 1.5 });
    if (!spot) { toast(`No free space on sheet ${si + 1}`, true); return; }
    pinLayout(); manual.pieces[e.key] = { s: n ? L.sheets.length : si, x: spot.x, y: spot.y, rot: !!e.rot };
    follow = { key: e.key, msg: 'Moved to sheet ' }; refresh(false); }
  function duplicatePiece(e) { const it = e.it, L = layout, p = e.p;
    if (!manual) { it.qty++; refresh(true); toast('Copy added'); return; }
    let si = curSheet, spot = placeOn(si, null, p, { x: e.x + p.cutW + S.spacing, y: e.y, r: 2 });
    for (let i = 0; !spot && i < L.sheets.length; i++) { spot = placeOn(i, null, p, null); si = i; }
    pinLayout(); const key = pieceKey(it, it.qty); it.qty++;
    if (spot) manual.pieces[key] = { s: si, x: spot.x, y: spot.y, rot: !!e.rot }; // else computeLayout finds room (new sheet if needed)
    sel = { key, itemId: it.id }; follow = { key, msg: 'Copy added on sheet ' }; refresh(true); }
  function deletePiece(e) { const it = e.it, q = +e.key.split('#')[1];
    if (manual) { pinLayout(); for (let j = q; j < it.qty - 1; j++) manual.pieces[pieceKey(it, j)] = manual.pieces[pieceKey(it, j + 1)]; delete manual.pieces[pieceKey(it, it.qty - 1)]; }
    it.qty = Math.max(0, it.qty - 1); sel = { key: null, itemId: it.id }; refresh(true); toast(`Removed one copy of ${it.name} (Ctrl+Z to undo)`); }
  /** raise qty until the existing sheet(s) are full (never adds a sheet) */
  function fillQty(it) { const L = layout || computeLayout(), base = Math.max(1, L.sheets.length), q0 = it.qty, B = boundsOf(L), sp = S.spacing;
    const p0 = processed(it, false); if (tooBig(p0, it)) { toast('This image is too large for the usable area', true); return; }
    if (manual) { pinLayout(); const lists = L.sheets.map(l => l.map(rectOf)); while (!L.sheets.length && lists.length < 1) lists.push([]); let added = 0;
      const fake = (r) => ({ x: r.x, y: r.y, p: { cutW: r.w, cutH: r.h } });
      for (let si = 0; si < lists.length; si++) for (let guard = 0; guard < 1000; guard++) { let got = null;
        for (const rot of [false].concat(S.rotate && it.rotate ? [true] : [])) { const p = processed(it, rot), n = findSpot(lists[si].map(fake), p.cutW, p.cutH, B, sp, null); if (n) { got = { n, rot }; break; } }
        if (!got) break; lists[si].push(got.n); manual.pieces[pieceKey(it, it.qty)] = { s: si, x: got.n.x, y: got.n.y, rot: got.rot }; it.qty++; added++; }
      refresh(true); toast(added ? `Added ${added} cop${added === 1 ? 'y' : 'ies'} to fill the free space` : 'No free space left for this image'); return; }
    const sp2 = sp, uw = L.uw, uh = L.uh, others = [];
    for (const o of items) if (o !== it) { const p = processed(o, false); for (let q = 0; q < o.qty; q++) others.push({ id: 'o' + o.id + '#' + q, w: p.cutW + sp2, h: p.cutH + sp2, canRotate: o.rotate }); }
    const fits = (n) => { const r = others.slice(); for (let q = 0; q < n; q++) r.push({ id: 't#' + q, w: p0.cutW + sp2, h: p0.cutH + sp2, canRotate: it.rotate }); const pk = C.packAll(r, uw + sp2, uh + sp2, S.rotate); return pk.sheets.length <= base && !pk.unplaced.length; };
    let lo = Math.max(1, q0); if (!fits(lo)) lo = 1; let hi = lo * 2; while (hi <= 1000 && fits(hi)) { lo = hi; hi *= 2; } hi = Math.min(hi, 1001);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fits(mid)) lo = mid; else hi = mid; }
    it.qty = Math.max(q0, lo); refresh(true); toast(it.qty > q0 ? `Qty ${q0} → ${it.qty}: fills ${base} sheet${base > 1 ? 's' : ''}` : 'The sheet is already full for this image'); }
  function bindSettings() {
    const bind = (id, key, conv) => { const el = $('#' + id); if (!el) return;
      const show = () => { if (el.type === 'checkbox') el.checked = !!S[key]; else el.value = conv ? conv.show(S[key]) : S[key]; };
      show(); el.addEventListener('change', () => { S[key] = el.type === 'checkbox' ? el.checked : conv ? conv.parse(el.value) : (el.type === 'number' ? parseFloat(el.value) : el.value); saveSettings(); if (key === 'unit') rebindLengths(); if (['dpi', 'bleed'].includes(key)) cache.clear(); refresh(true); });
      el._show = show; };
    const len = { show: v => toU(v), parse: v => fromU(parseFloat(v)) }, mm = { show: v => +(v * MM).toFixed(2), parse: v => parseFloat(v) / MM };
    bind('sheet', 'sheet'); bind('landscape', 'landscape'); bind('customW', 'customW', len); bind('customH', 'customH', len); bind('unit', 'unit');
    bind('margin', 'margin', len); bind('spacing', 'spacing', len); bind('bleed', 'bleed', mm); bind('dpi', 'dpi', { show: v => v, parse: v => parseInt(v, 10) });
    bind('rotate', 'rotate'); bind('anchor', 'anchor'); bind('marks', 'marks'); bind('applyCorr', 'applyCorr'); bind('inset', 'inset', len); bind('printerMargin', 'printerMargin', len);
    window._rebind = () => $$('input,select', $('#settings')).forEach(e => e._show && e._show());
  }
  function rebindLengths() { $$('.u').forEach(e => e.textContent = S.unit); window._rebind(); }
  function renderCalTable() {
    const sh = sheetDims(), tb = $('#caltable tbody'), key = sh.key, c = getCal();
    if (tb.dataset.key !== key) { tb.innerHTML = ''; tb.dataset.key = key; $('#verdict').innerHTML = ''; } // keep typed readings + misfits when only re-saving
    let fresh = false; if (!tb.children.length) { fresh = true; for (const t of calTargets(sh)) tb.insertAdjacentHTML('beforeend', `<tr><td>${t.id}</td><td>${t.label}</td><td><input type="number" step="0.25" data-t="${t.id}" data-a="x" placeholder="±8 mm"></td><td><input type="number" step="0.25" data-t="${t.id}" data-a="y" placeholder="±8 mm"></td><td class="res" data-t="${t.id}"></td></tr>`);
      $$('#caltable input').forEach(i => { i.addEventListener('input', saveDraft); i.addEventListener('input', () => markRange(i)); }); }
    // sheet-code choices: codes of calibration files made so far (newest first) + an uncorrected sheet
    const sel = $('#calCode'), prev = sel.value, issued = Object.entries(c.issued || {}).sort((a, b) => b[1].t - a[1].t);
    sel.innerHTML = issued.map(([k, v]) => `<option value="${k}">${k} – made ${new Date(v.t).toLocaleString()}${v.ex !== 1 || v.ey !== 1 ? ` (compensation ${fmtPct(v.ex - 1)}/${fmtPct(v.ey - 1)})` : ''}</option>`).join('') + `<option value="none">No code on the sheet (made before this version / uncorrected)</option>`;
    sel.value = issued.some(([k]) => k === prev) || prev === 'none' ? prev : (c.lastIssued && issued.some(([k]) => k === c.lastIssued) ? c.lastIssued : (issued[0] ? issued[0][0] : 'none'));
    if (fresh) { restoreDraft(); $$('#caltable input').forEach(markRange); }
    $('#corrNow').innerHTML = `Saved for ${key}: ${corrWords()}.`; $('#calLoaded').innerHTML = calStatusLine();
    const q = C.normCorr(c.Q), th = (q.a21 - q.a12) / 2;
    $('#mShX').value = +((1 - q.a11) * 100).toFixed(3); $('#mShY').value = +((1 - q.a22) * 100).toFixed(3); $('#mRot').value = +(-th * 180 / Math.PI).toFixed(3);
    $('#mOffX').value = +(-q.tx * MM).toFixed(3); $('#mOffY').value = +(-q.ty * MM).toFixed(3);
    $('#mCompX').value = +(((c.ex || 1) - 1) * 100).toFixed(3); $('#mCompY').value = +(((c.ey || 1) - 1) * 100).toFixed(3); $('#calTol').value = +((c.tol || 0.5 / MM) * MM).toFixed(2);
    renderWizard();
  }
  function markRange(i) { const v = parseFloat(i.value), over = isFinite(v) && Math.abs(v) > SCALE_MM;
    i.classList.toggle('over', over); i.title = over ? `Beyond the ±${SCALE_MM} mm printed scale – the slit probably missed the scale; it is used as typed, but re-check it` : ''; }
  function overRange(readings) { const o = []; for (const id in readings) for (const a of ['x', 'y']) { const v = readings[id][a]; if (v !== '' && isFinite(v) && Math.abs(v) > SCALE_MM) o.push(`${id} ${a.toUpperCase()} = ${v}`); } return o; }
  function readCalInputs() { const r = {}; $$('#caltable input').forEach(i => { (r[i.dataset.t] = r[i.dataset.t] || {})[i.dataset.a] = i.value === '' ? '' : parseFloat(i.value); }); return r; }

  async function handleFiles(files) {
    $('#busy').style.display = '';
    for (const f of files) {
      if (/\.heic$/i.test(f.name) || /heic|heif/i.test(f.type || '')) { alert('Please choose a PNG or JPG. On iPhone: Settings → Camera → Formats → Most Compatible.'); continue; }
      if (!/image\/(png|jpe?g|svg\+xml|webp|gif)/i.test(f.type) && !/\.(png|jpe?g|svg|webp|gif)$/i.test(f.name)) continue;
      try { await addFile(f); } catch (e) { alert(/\.(heic|heif)$/i.test(f.name) ? 'Please choose a PNG or JPG. On iPhone: Settings → Camera → Formats → Most Compatible.' : (f.name + ': ' + e.message)); }
    }
    refresh(true);
  }
  /** everything in one object: settings, calibration, every image (data URL) with its size/cut settings, hand placement, the mockup incl. its background image */
  function projectData(kind) {
    const calibration = {}; for (const k of STORE.keys()) if (/^cst\.cal\./.test(k)) { try { calibration[k] = JSON.parse(STORE.get(k)); } catch (e) { /* skip */ } }
    const data = { app: 'cricut-full-sheet-tool', v: 1, settings: S, calibration, items: items.map(i => ({ name: i.name, dataURL: i.dataURL, isSvg: i.isSvg, wIn: i.wIn, hIn: i.hIn, pct: +pctOf(i).toFixed(3), baseWIn: i.baseWIn, qty: i.qty, shape: i.shape, radiusIn: i.radiusIn, offsetIn: i.offsetIn, border: i.border, rotate: i.rotate, lockAR: i.lockAR !== false, collapsed: !!i.collapsed, ...(i.asset ? { asset: i.asset } : {}), ...(isWarped(i) ? { warp: i.warp } : {}) })) };
    data.mockup = mkSerial(true);
    if (manual) { const idx = new Map(items.map((it, i) => [String(it.id), i])); data.placement = { pieces: Object.entries(manual.pieces).map(([k, v]) => ({ i: idx.get(k.split('#')[0]), q: +k.split('#')[1], s: v.s, x: v.x, y: v.y, rot: !!v.rot, o: v.o })).filter(p => p.i != null) }; }
    if (kind) data.kind = kind; data.saved = Date.now(); return data;
  }
  async function saveProject() { noteFileSave(); saveBlob('cricut-sheet-project.json', JSON.stringify(projectData()), 'application/json'); }
  async function loadProject(file) { await applyProject(JSON.parse(await readAsText(file))); }
  /** restore a project / mockup save. o.settings / o.cal = false keep this browser's sheet settings and calibration (Open mockup, browser saves, autosave) */
  async function applyProject(d, o) { o = o || {}; if (!d || d.app !== 'cricut-full-sheet-tool') throw new Error('Not a project or mockup file');
    const sameSheet = !d.settings || (d.settings.sheet === S.sheet && !!d.settings.landscape === !!S.landscape);
    if (o.settings !== false) { const keepCol = { mkCol: S.mkCol }; Object.assign(S, d.settings || {}, keepCol.mkCol ? keepCol : {}); saveSettings(); }
    items = []; cache.clear();
    if (o.cal !== false && d.calibration && Object.keys(d.calibration).length) { try { importCalData(d, true); } catch (e) { /* project without usable calibration */ } }
    manual = null; sel = { key: null, itemId: null }; undoStack = []; redoStack = []; curSnap = null; curSheet = 0;
    for (const i of d.items || []) { const { dataURL, name, isSvg, ...rest } = i; await addFromDataURL(name, dataURL, dataURL, isSvg, rest); }
    if (d.mockup) { MK = mkLoad(d.mockup); MK.nodes.forEach(n => { if (n.i != null && items[n.i]) n.itemId = items[n.i].id; delete n.i; }); mkSel = null; mkUndo = []; mkRedo = []; mkCur = null; mkAutosave(); mkBgLoad(); }
    if (d.placement && Array.isArray(d.placement.pieces) && (o.settings !== false || sameSheet)) { manual = { pieces: {} }; for (const p of d.placement.pieces) { const it = items[p.i]; if (it) manual.pieces[pieceKey(it, p.q)] = { s: p.s, x: p.x, y: p.y, rot: !!p.rot, o: p.o }; } }
    window._rebind(); rebindLengths(); refresh(true);
  }

  function init() {
    applyChrome();
    bindSettings(); rebindLengths();
    const dz = $('#drop'), fi = $('#file');
    dz.addEventListener('click', () => fi.click()); fi.addEventListener('change', () => { handleFiles(Array.from(fi.files)); fi.value = ''; });
    ['dragenter', 'dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', ev => handleFiles(Array.from(ev.dataTransfer.files)));
    document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => { if (!dz.contains(e.target)) { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files)); } });
    ['showPrint', 'showCut', 'showAnchors'].forEach(id => $('#' + id).addEventListener('change', renderPreview));
    $('#expPDF').onclick = () => { try { saveBlob(base() + '-PRINT.pdf', buildPDF().output('blob')); } catch (e) { alert(e.message); } };
    $('#expSVG').onclick = () => { try { const s = buildSVGs(); s.forEach((t, i) => setTimeout(() => saveBlob(`${base()}-${i + 1}-CUT.svg`, t, 'image/svg+xml'), i * 400)); } catch (e) { alert(e.message); } };
    $('#saveProj').onclick = saveProject; $('#loadProj').onclick = () => $('#projFile').click();
    $('#projFile').onchange = async (e) => { try { await loadProject(e.target.files[0]); } catch (er) { alert(er.message); } e.target.value = ''; };
    $$('.tabs button[data-tab]').forEach(b => b.onclick = () => { $$('.tabs button[data-tab]').forEach(x => x.classList.toggle('on', x === b)); $$('.tab').forEach(t => t.style.display = t.id === b.dataset.tab ? '' : 'none'); if (b.dataset.tab === 'tabCal') renderCalTable(); if (b.dataset.tab === 'tabLayout') renderPreview(); if (b.dataset.tab === 'tabMock') renderMock(); if (window.CST && window.CST.bus) window.CST.bus.emit('tab:shown', b.dataset.tab); });
    $('#calCompute').onclick = () => onCompute();
    $('#calManual').onclick = () => { const c = getCal(), sx = 1 - (+$('#mShX').value || 0) / 100, sy = 1 - (+$('#mShY').value || 0) / 100, th = -(+$('#mRot').value || 0) * Math.PI / 180;
      c.Q = { v: 2, a11: sx, a12: -th, a21: th, a22: sy, tx: -(+$('#mOffX').value || 0) / MM, ty: -(+$('#mOffY').value || 0) / MM };
      c.ex = 1 + (+$('#mCompX').value || 0) / 100; c.ey = 1 + (+$('#mCompY').value || 0) / 100; c.mode = (c.ex !== 1 || c.ey !== 1) ? 'compensate' : (c.mode || 'keep'); c.status = 'verify';
      c.tol = Math.max(0.1, +$('#calTol').value || 0.5) / MM; saveCal(c); renderCalTable(); refresh(false); };
    if (EMBEDDED && EMBEDDED.cal) for (const k of Object.keys(EMBEDDED.cal).filter(k => /^cst\.cal\./.test(k)))
      if (!STORE.get(k)) { try { importCalData({ kind: 'calibration', cal: { [k]: EMBEDDED.cal[k], ...(EMBEDDED.cal['cst.draft.' + k.slice(8)] ? { ['cst.draft.' + k.slice(8)]: EMBEDDED.cal['cst.draft.' + k.slice(8)] } : {}) } }, false); LOAD.fromFile[k.slice(8)] = true; } catch (e) { /* ignore */ } }
    for (const k of STORE.keys()) if (/^cst\.(cal|corr)\./.test(k)) LOAD.had[k.replace(/^cst\.(cal|corr)\./, '')] = true;
    $('#calSaveTool').onclick = () => { try { saveToolCopy(); $('#calLoaded').innerHTML = calStatusLine() + ' <span class="muted">· saved a copy of the tool with this calibration built in</span>'; } catch (e) { alert(e.message); } };
    $('#rulerX').addEventListener('input', saveDraft); $('#rulerY').addEventListener('input', saveDraft); $('#calCode').addEventListener('change', saveDraft);
    $('#calExport').onclick = () => { exportCal(); $('#calLoaded').innerHTML = calStatusLine() + ' <span class="muted">· exported</span>'; };
    $('#calImport').onclick = () => $('#calFile').click();
    $('#calFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const d = JSON.parse(await readAsText(f)); const n = importCalData(d, true); if (!n) return;
        if (d.sheet && d.sheet.sheet) { Object.assign(S, d.sheet); saveSettings(); window._rebind && window._rebind(); rebindLengths(); }
        LOAD.had[sheetDims().key] = true; lastResult = null; $('#verdict').innerHTML = ''; $('#caltable tbody').innerHTML = ''; refresh(false); renderCalTable();
        $('#calLoaded').innerHTML = calStatusLine().replace('Calibration loaded', 'Calibration imported') + ` <span class="muted">(${n} sheet size${n > 1 ? 's' : ''} from ${f.name})</span>`;
      } catch (er) { alert('Import failed: ' + er.message); } };
    $('#calTol').onchange = () => { const c = getCal(); c.tol = Math.max(0.1, +$('#calTol').value || 0.5) / MM; saveCal(c); };
    $('#calReset').onclick = () => { if (confirm('Reset the saved calibration for this sheet size (printer model, compensation and wizard progress)?')) { saveCal(C.calDefault()); STORE.del(draftKey()); $$('#caltable input').forEach(i => i.value = ''); lastResult = null; $('#verdict').innerHTML = ''; renderCalTable(); refresh(false); } };
    window.addEventListener('resize', () => renderPreview());
    bindCanvas(); bindMock();
    const nudgeHide = $('#storageNudgeHide'); if (nudgeHide) nudgeHide.onclick = () => { $('#storageNudge').hidden = true; try { sessionStorage.setItem('cst.storageNudge', '1'); } catch (e) { /* ignore */ } };
    storageNudge();
    $('#numberPieces').checked = !!S.numberPieces; $('#numberPieces').onchange = () => { S.numberPieces = $('#numberPieces').checked; saveSettings(); refresh(false); };
    $('#ifilter').addEventListener('input', () => { filterText = $('#ifilter').value; applyFilter(); });
    $('#collapseAll').onclick = () => items.forEach(it => setCollapsed(it, null, true));
    $('#expandAll').onclick = () => items.forEach(it => setCollapsed(it, null, false));
    const sp = $('#settings'), setSheetCol = (v) => { S.sheetCollapsed = v; sp.classList.toggle('collapsed', v); $('#sheetChev').setAttribute('aria-expanded', String(!v)); $('#sheetChev').title = v ? 'Expand' : 'Collapse'; $('#sheetSum').textContent = v ? sheetSummary() : ''; };
    window._sheetSum = () => { $('#sheetSum').textContent = S.sheetCollapsed ? sheetSummary() : ''; };
    $('#settings > h2').onclick = () => { setSheetCol(!S.sheetCollapsed); saveSettings(); };
    setSheetCol(!!S.sheetCollapsed);
    refresh(true);
  }
  // ---------- Mockup / Assemble (view only: never changes the cut layout, sizes or any export of the Layout tab) ----------
  const MK_PRESETS = { 'letter-P': ['Letter portrait', 8.5, 11], 'letter-L': ['Letter landscape', 11, 8.5], 'a4-P': ['A4 portrait', 8.268, 11.693], 'a4-L': ['A4 landscape', 11.693, 8.268], 'sq12': ['12 × 12 in', 12, 12], '8x10': ['8 × 10 in', 8, 10], '10x8': ['10 × 8 in', 10, 8], '5x7': ['5 × 7 in', 5, 7], 'custom': ['Custom size', null, null] };
  const mkDefault = () => ({ v: 1, bg: { preset: 'letter-P', w: 8.5, h: 11, color: '#fbf3ec', img: null, fit: 'fill', scale: 100, ox: 0, oy: 0, rot: 0, opacity: 1, dpi: 150 }, guide: 'off', ghost: 0.3, snap: true, num: { show: 'all', size: 100 }, nodes: [], skip: {}, nextUid: 1 });
  const mkNumDef = () => ({ show: 'all', size: 100 });
  function mkLoad(d) { const m = mkDefault(); if (!d || typeof d !== 'object') return m; Object.assign(m, d); m.bg = Object.assign(mkDefault().bg, d.bg || {}); m.skip = d.skip || {}; m.num = Object.assign(mkNumDef(), d.num || {});
    m.nodes = (d.nodes || []).map(n => ({ uid: n.uid, name: n.name, itemId: null, i: n.i, x: +n.x || 0, y: +n.y || 0, rot: +n.rot || 0, flip: !!n.flip, hidden: !!n.hidden, noNum: !!n.noNum, warp: warpClean(n.warp) }));
    m.nextUid = Math.max(m.nextUid || 1, ...m.nodes.map(n => (n.uid || 0) + 1)); m.nodes.forEach(n => { if (!n.uid) n.uid = m.nextUid++; }); return m; }
  let MK = (() => { try { return mkLoad(JSON.parse(STORE.get('cst.mockup') || 'null')); } catch (e) { return mkDefault(); } })();
  const mkSerial = (withIdx) => ({ v: 1, bg: MK.bg, guide: MK.guide, ghost: MK.ghost, snap: MK.snap, skip: MK.skip, nextUid: MK.nextUid, num: MK.num,
    nodes: MK.nodes.map(n => { const it = nodeItem(n), o = { uid: n.uid, name: it ? it.name : n.name, x: n.x, y: n.y, rot: n.rot, flip: n.flip, hidden: n.hidden }; if (n.noNum) o.noNum = true; if (isWarped(n)) o.warp = n.warp; if (withIdx && it) o.i = items.indexOf(it); return o; }) });
  let mkSaveT = null;
  function mkAutosave() { mkIdbSoon(); mkPanelSums(); clearTimeout(mkSaveT); mkSaveT = setTimeout(() => { try { STORE.set('cst.mockup', JSON.stringify(mkSerial(false))); }
    catch (e) { try { STORE.set('cst.mockup', JSON.stringify(Object.assign(mkSerial(false), { bg: Object.assign({}, MK.bg, { img: null }) }))); } catch (e2) { /* storage full */ } } }, 250); }
  let mkSel = null, mkDrag = null, mkView = { sc: 50, pad: 30 }, mkSnapLines = [], mkUndo = [], mkRedo = [], mkCur = null;
  function nodeItem(n) { let it = n.itemId != null ? items.find(i => i.id === n.itemId) : null;
    if (!it && n.name) { const m = /^(.*) \((?:warped \d+|unwarped)\)$/.exec(n.name); it = items.find(i => i.name === n.name) || (m && items.find(i => i.name === m[1])); if (it) n.itemId = it.id; } return it || null; }
  function ng(n) { const it = nodeItem(n); if (!it) return null; const p = processedBase(it); return { it, p, w: p.cutW, h: p.cutH }; }
  const rad = (d) => d * Math.PI / 180;
  function nodeAABB(n, G) { G = G || ng(n); if (!G) return null;
    if (isWarped(n)) { const pts = warpQuad(n, G).map(([x, y]) => boxToWorld(n, G, x, y)); return { x0: Math.min(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), x1: Math.max(...pts.map(p => p[0])), y1: Math.max(...pts.map(p => p[1])) }; }
    const c = Math.abs(Math.cos(rad(n.rot))), s = Math.abs(Math.sin(rad(n.rot))), W = G.w * c + G.h * s, H = G.w * s + G.h * c;
    return { x0: n.x - W / 2, y0: n.y - H / 2, x1: n.x + W / 2, y1: n.y + H / 2 }; }
  function toLocal(n, x, y) { const dx = x - n.x, dy = y - n.y, c = Math.cos(-rad(n.rot)), s = Math.sin(-rad(n.rot)); let lx = dx * c - dy * s; const ly = dx * s + dy * c; if (n.flip) lx = -lx; return [lx, ly]; }
  // ---------- Transform (skew / free distort): drawn in the Mockup and baked into the printed sticker ----------
  // Each copy (node) has its own warp; the image's warp (it.warp, what prints and cuts) follows its copies (see syncItemWarps); Send to Layout splits copies with different warps
  // n.warp = { sx, sy (skew °, about the piece centre), q: [[dx,dy] x4] extra corner offsets TL, TR, BR, BL } in the piece's own box (inches, before flip/rotation)
  function isWarped(n) { return !!(n && n.warp && (n.warp.sx || n.warp.sy || (n.warp.q || []).some(c => c && (c[0] || c[1])))); }
  // hoisted: mkLoad() runs at startup, before this point
  function warpClean(w) { if (!w || typeof w !== 'object') return null; const o = { sx: Math.max(-75, Math.min(75, +w.sx || 0)), sy: Math.max(-75, Math.min(75, +w.sy || 0)), q: [0, 1, 2, 3].map(i => { const c = (w.q || [])[i] || [0, 0]; return [+c[0] || 0, +c[1] || 0]; }) }; return isWarped({ warp: o }) ? o : null; }
  function warpQuad(n, G) { const w = G.w, h = G.h, W = n.warp || {}, tx = Math.tan(rad(W.sx || 0)), ty = Math.tan(rad(W.sy || 0)), q = W.q || [];
    return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y], i) => [x + tx * (y - h / 2) + ((q[i] || [])[0] || 0), y + ty * (x - w / 2) + ((q[i] || [])[1] || 0)]); }
  /** projective map of the piece box [0,w]×[0,h] onto its warped quad (Heckbert square→quad); null = not warped */
  function warpMap(n, G) { if (!isWarped(n)) return null; const P = warpQuad(n, G), [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = P;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
    const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0, h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
    const iA = e - f * h, iB = f * g - d, iC = d * h - e * g, iD = c * h - b, iE = a - c * g, iF = b * g - a * h, iG = b * f - c * e, iH = c * d - a * f, iI = a * e - b * d;
    return { P, f: (x, y) => { const u = x / G.w, v = y / G.h, k = g * u + h * v + 1; return [(a * u + b * v + c) / k, (d * u + e * v + f) / k]; },
      inv: (X, Y) => { const s = iC * X + iF * Y + iI; return [G.w * (iA * X + iD * Y + iG) / s, G.h * (iB * X + iE * Y + iH) / s]; } }; }
  const warpSig = (w) => JSON.stringify(warpClean(w));
  /** the image's printed warp = the warp most of its Mockup copies share (ties: the lowest layer). Images with no copies keep theirs. true = something changed */
  function syncItemWarps() { const by = new Map(); let ch = false;
    for (const n of MK.nodes) { const it = nodeItem(n); if (!it) continue; let m = by.get(it); if (!m) by.set(it, m = new Map()); const s = isWarped(n) ? warpSig(n.warp) : ''; m.set(s, (m.get(s) || 0) + 1); }
    for (const [it, m] of by) { let best = '', bc = -1; for (const [s, c] of m) if (c > bc) { best = s; bc = c; }
      if (best !== (isWarped(it) ? warpSig(it.warp) : '')) { it.warp = best ? JSON.parse(best) : null; ch = true; } }
    return ch; }
  /** copies of n's image whose warp differs from n's */
  const warpOthers = (n) => { const it = nodeItem(n), s = isWarped(n) ? warpSig(n.warp) : ''; return MK.nodes.filter(m => m !== n && nodeItem(m) === it && (isWarped(m) ? warpSig(m.warp) : '') !== s).length; };
  const warpPathCache = new WeakMap();
  /** the piece's cut outline in its box frame, warped when it has a transform */
  function nodePath(n, G) { const M = warpMap(n, G); if (!M) return loopPath(G.p); const c = warpPathCache.get(n.warp); if (c && c.p === G.p && c.w === G.w && c.h === G.h) return c.path;
    const path = new Path2D(); for (const poly of flatLoops(G.p)) { poly.forEach(([x, y], i) => { const [a, b] = M.f(x, y); if (i) path.lineTo(a, b); else path.moveTo(a, b); }); path.closePath(); }
    warpPathCache.set(n.warp, { p: G.p, w: G.w, h: G.h, path }); return path; }
  /** box frame -> backdrop inches (flip, rotation, position) */
  function boxToWorld(n, G, x, y) { let lx = x - G.w / 2; const ly = y - G.h / 2; if (n.flip) lx = -lx; const c = Math.cos(rad(n.rot)), s = Math.sin(rad(n.rot)); return [n.x + lx * c - ly * s, n.y + lx * s + ly * c]; }
  /** draw the print image through the warp: an N×N mesh, each triangle an affine piece of the projective map (clipped, with a hair of overlap so no seams show) */
  /** triangle grown by e on every edge (mitre capped), so neighbouring triangles overlap and no antialiasing seam shows */
  function growTri(P, e) { const L = [0, 1, 2].map(i => { const a = P[i], b = P[(i + 1) % 3], c = P[(i + 2) % 3], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; let nx = dy / l, ny = -dx / l; if (nx * (c[0] - a[0]) + ny * (c[1] - a[1]) > 0) { nx = -nx; ny = -ny; } return { p: [a[0] + nx * e, a[1] + ny * e], d: [dx, dy] }; });
    return [0, 1, 2].map(i => { const A = L[(i + 2) % 3], B = L[i], cr = A.d[0] * B.d[1] - A.d[1] * B.d[0], V = P[i]; if (Math.abs(cr) < 1e-12) return V;
      const t = ((B.p[0] - A.p[0]) * B.d[1] - (B.p[1] - A.p[1]) * B.d[0]) / cr, X = [A.p[0] + A.d[0] * t, A.p[1] + A.d[1] * t], dd = Math.hypot(X[0] - V[0], X[1] - V[1]);
      return dd > 4 * e ? [V[0] + (X[0] - V[0]) * 4 * e / dd, V[1] + (X[1] - V[1]) * 4 * e / dd] : X; }); }
  function drawWarped(g, G, M, sc) { const pr = G.p.print, w = G.w, h = G.h, mx = Math.max(w, h), NX = Math.max(4, Math.round(16 * w / mx)), NY = Math.max(4, Math.round(16 * h / mx)), src = [], dst = [], ex = 0.8 / sc;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const x = w * i / NX, y = h * j / NY; src.push([x, y]); dst.push(M.f(x, y)); }
    const id = (i, j) => j * (NX + 1) + i;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) for (const t of [[id(i, j), id(i + 1, j), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i, j + 1)]]) {
      const [s0, s1, s2] = t.map(k => src[k]), [d0, d1, d2] = t.map(k => dst[k]);
      const u1x = s1[0] - s0[0], u1y = s1[1] - s0[1], u2x = s2[0] - s0[0], u2y = s2[1] - s0[1], v1x = d1[0] - d0[0], v1y = d1[1] - d0[1], v2x = d2[0] - d0[0], v2y = d2[1] - d0[1], dn = u1x * u2y - u2x * u1y; if (!dn) continue;
      const A = (v1x * u2y - v2x * u1y) / dn, C = (v2x * u1x - v1x * u2x) / dn, B = (v1y * u2y - v2y * u1y) / dn, D = (v2y * u1x - v1y * u2x) / dn, E = d0[0] - A * s0[0] - C * s0[1], F = d0[1] - B * s0[0] - D * s0[1];
      g.save(); g.beginPath(); growTri([d0, d1, d2], ex).forEach(([x, y], k) => { if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.clip();
      g.transform(A, B, C, D, E, F); g.drawImage(pr.canvas, pr.x, pr.y, pr.w, pr.h); g.restore(); } }
  const pathCache = new WeakMap();
  function loopPath(p) { let P = pathCache.get(p); if (P) return P; P = new Path2D();
    for (const l of p.loops) for (const s of l) { if (s[0] === 'M') P.moveTo(s[1], s[2]); else if (s[0] === 'L') P.lineTo(s[1], s[2]); else if (s[0] === 'C') P.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]); else P.closePath(); }
    pathCache.set(p, P); return P; }
  let hitCtx = null;
  function mkHit(x, y) { hitCtx = hitCtx || document.createElement('canvas').getContext('2d');
    for (let i = MK.nodes.length - 1; i >= 0; i--) { const n = MK.nodes[i]; if (n.hidden) continue; const G = ng(n); if (!G) continue; const [lx, ly] = toLocal(n, x, y);
      const wq = isWarped(n); if (!wq && (Math.abs(lx) > G.w / 2 || Math.abs(ly) > G.h / 2)) continue;
      if ((n === mkSel && !wq) || hitCtx.isPointInPath(nodePath(n, G), lx + G.w / 2, ly + G.h / 2, 'evenodd')) return n;
      if (n === mkSel && wq) { const q = new Path2D(), P = warpQuad(n, G); P.forEach(([a, b], i) => i ? q.lineTo(a, b) : q.moveTo(a, b)); q.closePath(); if (hitCtx.isPointInPath(q, lx + G.w / 2, ly + G.h / 2)) return n; } }
    return null; }
  function mkFreeSpot(w, h) { const B = MK.bg, boxes = MK.nodes.map(n => nodeAABB(n)).filter(Boolean), g = 0.15;
    for (let y = 0.25; y + h <= B.h - 0.1; y += 0.25) for (let x = 0.25; x + w <= B.w - 0.1; x += 0.25) { if (boxes.every(b => x + w + g <= b.x0 || b.x1 + g <= x || y + h + g <= b.y0 || b.y1 + g <= y)) return { x: x + w / 2, y: y + h / 2 }; }
    return { x: B.w / 2 + (Math.random() - 0.5) * 0.5, y: B.h / 2 + (Math.random() - 0.5) * 0.5 }; }
  function mkAdd(it, near) { const p = processedBase(it), c = near ? { x: Math.min(MK.bg.w, near.x + 0.35), y: Math.min(MK.bg.h, near.y + 0.35) } : mkFreeSpot(p.cutW, p.cutH);
    const n = { uid: MK.nextUid++, name: it.name, itemId: it.id, x: c.x, y: c.y, rot: near ? near.rot : 0, flip: near ? near.flip : false, hidden: false, noNum: false, warp: warpClean(near ? near.warp : it.warp) }; MK.nodes.push(n); delete MK.skip[it.name]; return n; }
  /** one instance of every image (unless the user deleted all of an image's instances); keeps dormant nodes of images not loaded right now */
  function mkEnsure() { let added = 0; for (const it of items) if (!MK.nodes.some(n => nodeItem(n) === it) && !MK.skip[it.name]) { mkAdd(it); added++; } return added; }
  const mkLive = () => MK.nodes.filter(n => nodeItem(n));

  // drawing (screen + exports share this)
  function mkDraw(g, o) { // o: { sc, pad, mode: 'off'|'outline'|'ghost', ui, ghost }
    const B = MK.bg, sc = o.sc, pad = o.pad || 0;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.translate(pad, pad); g.scale(sc, sc);
    g.fillStyle = B.color || '#fff'; g.fillRect(0, 0, B.w, B.h);
    const R = mkBgRect(); if (R) { g.save(); g.beginPath(); g.rect(0, 0, B.w, B.h); g.clip(); g.globalAlpha = (o.mode !== 'off' ? 0.35 : 1) * R.op; g.translate(R.cx, R.cy); g.rotate(rad(R.rot));
      if (R.tile) { const n = Math.ceil(R.reach / R.dw) + 1, m = Math.ceil(R.reach / R.dh) + 1; for (let i = -n; i <= n; i++) for (let j = -m; j <= m; j++) g.drawImage(mkBgImg, (i - 0.5) * R.dw, (j - 0.5) * R.dh, R.dw, R.dh); }
      else g.drawImage(mkBgImg, -R.dw / 2, -R.dh / 2, R.dw, R.dh);
      g.restore();
      if (o.ui && mkBgAdj) { g.save(); g.translate(R.cx, R.cy); g.rotate(rad(R.rot)); g.strokeStyle = '#e07b00'; g.lineWidth = 2 / sc; g.setLineDash([7 / sc, 4 / sc]); g.strokeRect(-R.dw / 2, -R.dh / 2, R.dw, R.dh); g.restore(); } }
    if (o.ui) { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1 / sc; g.strokeRect(0, 0, B.w, B.h); }
    const live = [], marks = o.mode !== 'off' && !o.noMarks;
    for (const n of MK.nodes) { if (n.hidden || o.mode === 'bgonly') continue; const G = ng(n); if (!G) continue; live.push([n, G]);
      g.save(); g.translate(n.x, n.y); g.rotate(rad(n.rot)); if (n._rs) g.scale(n._rs[0], n._rs[1]); if (n.flip) g.scale(-1, 1); g.translate(-G.w / 2, -G.h / 2);
      const P = nodePath(n, G), WM = warpMap(n, G);
      if (o.mode !== 'outline') { g.save(); g.globalAlpha = o.mode === 'ghost' ? (o.ghost != null ? o.ghost : MK.ghost) : 1; g.clip(P, 'evenodd'); const pr = G.p.print; if (WM) drawWarped(g, G, WM, sc); else g.drawImage(pr.canvas, pr.x, pr.y, pr.w, pr.h); g.restore(); }
      if (marks) { g.lineWidth = Math.max(1.2, sc / 60) / sc; g.strokeStyle = '#2b2f36'; g.setLineDash([6 / sc, 3 / sc]); g.stroke(P); g.setLineDash([]); }
      g.restore(); }
    if (marks && MK.num.show !== 'none') { const st = mkSteps(), r = Math.max(0.09, 11 / sc) * mkNumScale(); g.font = `bold ${r * 1.15}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const shown = live.filter(([n]) => !n.noNum), pos = mkNumPos(shown, r * 1.15, live);
      for (const [n] of shown) { const t = String(st.get(n)), [x, y] = pos.get(n); g.beginPath(); g.arc(x, y, r * badgeK(t), 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5 / sc; g.strokeStyle = '#2b2f36'; g.stroke(); g.fillStyle = '#1d2733'; g.fillText(t, x, y + r * 0.06); } }
    if (o.ui) {
      g.strokeStyle = '#e0115f'; g.lineWidth = 1 / sc; g.setLineDash([4 / sc, 3 / sc]); for (const l of mkSnapLines) { g.beginPath(); if (l.x != null) { g.moveTo(l.x, -1); g.lineTo(l.x, B.h + 1); } else { g.moveTo(-1, l.y); g.lineTo(B.w + 1, l.y); } g.stroke(); } g.setLineDash([]);
      const n = mkSel, G = n && !n.hidden && ng(n);
      if (G && (mkXf || isWarped(n))) { const P = warpQuad(n, G).map(([x, y]) => boxToWorld(n, G, x, y)); g.save(); g.strokeStyle = '#e07b00'; g.lineWidth = 1.5 / sc; g.setLineDash([5 / sc, 3 / sc]); g.beginPath(); P.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); g.setLineDash([]);
        if (mkXf) { const hs = 6 / sc; g.fillStyle = '#fff'; for (const [x, y] of mkWarpHandles(n, G)) { g.beginPath(); g.arc(x, y, hs, 0, Math.PI * 2); g.fill(); g.stroke(); } for (const [x, y] of mkWarpHandles(n, G).slice(4)) { g.fillStyle = '#e07b00'; g.fillRect(x - hs / 2, y - hs / 2, hs, hs); } }
        g.restore(); }
      if (G && !mkXf) { const W = G.w * (n._rs ? n._rs[0] : 1), H = G.h * (n._rs ? n._rs[1] : 1); g.save(); g.translate(n.x, n.y); g.rotate(rad(n.rot)); g.strokeStyle = '#1f6feb'; g.lineWidth = 1.5 / sc; g.setLineDash([5 / sc, 3 / sc]); if (!isWarped(n)) g.strokeRect(-W / 2, -H / 2, W, H); g.setLineDash([]);
        g.fillStyle = '#fff'; const hs = 5 / sc; for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.fillRect(cx * W / 2 - hs, cy * H / 2 - hs, 2 * hs, 2 * hs); g.strokeRect(cx * W / 2 - hs, cy * H / 2 - hs, 2 * hs, 2 * hs); }
        if (n._rs) { g.font = `${12 / sc}px sans-serif`; g.textAlign = 'center'; g.fillStyle = '#1f6feb'; g.fillText(`${fmtShort(W)} × ${fmtShort(H)}`, 0, H / 2 + 18 / sc); }
        const hy = -H / 2 - 24 / sc; g.beginPath(); g.moveTo(0, -G.h / 2); g.lineTo(0, hy); g.stroke(); g.beginPath(); g.arc(0, hy, 6 / sc, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.stroke(); g.restore(); } }
    g.restore(); }
  /** number badge spots: on the piece itself where no piece in front covers it, away from other badges; falls back to the centre */
  const mkNumScale = () => Math.max(0.3, Math.min(3, (+MK.num.size || 100) / 100));
  const badgeK = (t) => t.length > 2 ? 1.4 : t.length > 1 ? 1.15 : 1;
  function mkNumPos(list, r, all) { all = all || list; const out = new Map(), used = []; hitCtx = hitCtx || document.createElement('canvas').getContext('2d');
    const onPiece = (n, G, x, y) => { const [lx, ly] = toLocal(n, x, y); return (isWarped(n) || (Math.abs(lx) <= G.w / 2 && Math.abs(ly) <= G.h / 2)) && hitCtx.isPointInPath(nodePath(n, G), lx + G.w / 2, ly + G.h / 2, 'evenodd'); };
    const order = MK.nodes;
    for (const [n, G] of list) { const b = nodeAABB(n, G), above = all.filter(([m]) => order.indexOf(m) > order.indexOf(n));
      const good = (x, y) => used.every(([u, v]) => Math.hypot(u - x, v - y) >= 2.3 * r) && [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dy]) => onPiece(n, G, x + dx, y + dy) && !above.some(([m, H]) => onPiece(m, H, x + dx, y + dy)));
      const cand = [[n.x, n.y]]; const N = 9; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) cand.push([b.x0 + (b.x1 - b.x0) * i / N, b.y0 + (b.y1 - b.y0) * j / N]);
      cand.sort((p, q) => Math.hypot(p[0] - n.x, p[1] - n.y) - Math.hypot(q[0] - n.x, q[1] - n.y));
      const best = cand.find(([x, y]) => good(x, y)) || cand.find(([x, y]) => used.every(([u, v]) => Math.hypot(u - x, v - y) >= 2.3 * r) && onPiece(n, G, x, y)) || [n.x, n.y];
      used.push(best); out.set(n, best); }
    return out; }
  let mkBgImg = null, mkBgAdj = false;
  function mkBgLoad() { if (!MK.bg.img) { mkBgImg = null; return; } if (mkBgImg && mkBgImg._src === MK.bg.img) return; const im = new Image(); im._src = MK.bg.img; im.onload = () => { renderMockCanvas(); renderMkBg(); }; im.src = MK.bg.img; mkBgImg = im; }
  const mkBgReady = () => !!(MK.bg.img && mkBgImg && mkBgImg._src === MK.bg.img && mkBgImg.complete && mkBgImg.naturalWidth);
  /** natural size of the background image after the 90° turns (pixels) */
  function mkBgNat() { if (!mkBgReady()) return null; const w = mkBgImg.naturalWidth, h = mkBgImg.naturalHeight, q = ((MK.bg.rot || 0) / 90) % 2 !== 0; return q ? { w: h, h: w } : { w, h }; }
  /** where the background image goes, in backdrop inches: centre, drawn (unrotated) size, rotation. Fit modes: fit = contain, fill = cover (crop), stretch, original = true size at the image's dpi, tile = original size repeated */
  function mkBgRect() { const B = MK.bg, N = mkBgNat(); if (!N) return null; const fit = B.fit || 'fill', s = (B.scale > 0 ? B.scale : 100) / 100, dpi = B.dpi > 0 ? B.dpi : 150; let w, h;
    if (fit === 'fit' || fit === 'fill') { const k = (fit === 'fit' ? Math.min : Math.max)(B.w / N.w, B.h / N.h); w = N.w * k; h = N.h * k; }
    else if (fit === 'stretch') { w = B.w; h = B.h; } else { w = N.w / dpi; h = N.h / dpi; }
    w *= s; h *= s; const rot = ((B.rot || 0) % 360 + 360) % 360, q = (rot / 90) % 2 !== 0, ox = +B.ox || 0, oy = +B.oy || 0;
    const r = { cx: B.w / 2 + ox, cy: B.h / 2 + oy, w, h, dw: q ? h : w, dh: q ? w : h, rot, op: B.opacity != null ? Math.max(0, Math.min(1, +B.opacity)) : 1, tile: fit === 'tile' };
    if (r.tile) { const mn = Math.max(B.w, B.h) / 60; if (r.dw < mn || r.dh < mn) { const k = mn / Math.min(r.dw, r.dh); r.dw *= k; r.dh *= k; } r.reach = Math.hypot(B.w, B.h) / 2 + Math.hypot(ox, oy); }
    return r; }
  /** dpi stored in the file (PNG pHYs or JPEG JFIF), else null */
  function imgDpi(dataURL) { try { const b = atob(dataURL.split(',')[1].slice(0, 87384)), u = (i) => b.charCodeAt(i), be32 = (i) => ((u(i) << 24) >>> 0) + (u(i + 1) << 16) + (u(i + 2) << 8) + u(i + 3);
      if (b.startsWith('\x89PNG')) { let i = 8; while (i + 8 < b.length) { const L = be32(i), t = b.slice(i + 4, i + 8); if (t === 'pHYs') { const x = be32(i + 8); return u(i + 16) === 1 && x > 0 ? Math.round(x * 0.0254) : null; } if (t === 'IDAT') return null; i += 12 + L; } }
      if (u(0) === 0xFF && u(1) === 0xD8 && b.slice(6, 11) === 'JFIF\0') { const un = u(13), x = (u(14) << 8) + u(15); return x > 1 && un === 1 ? x : x > 1 && un === 2 ? Math.round(x * 2.54) : null; } } catch (e) { /* unreadable */ } return null; }
  const MK_BG_RESET = { fit: 'fill', scale: 100, ox: 0, oy: 0, rot: 0, opacity: 1 };
  /** backdrop = the image: at its dpi ('dpi') or keeping the backdrop width ('width'); then the image fills it exactly */
  function mkBgToBackdrop(how) { const N = mkBgNat(), B = MK.bg; if (!N) return; let w, h;
    if (how === 'width') { w = B.w; h = B.w * N.h / N.w; } else { const dpi = B.dpi > 0 ? B.dpi : 150; w = N.w / dpi; h = N.h / dpi; }
    const k = Math.min(1, 120 / Math.max(w, h)); w *= k; h *= k; if (Math.min(w, h) < 1) { const k2 = 1 / Math.min(w, h); w *= k2; h *= k2; }
    B.w = +w.toFixed(3); B.h = +h.toFixed(3); B.preset = 'custom'; Object.assign(B, MK_BG_RESET, { fit: 'fill', rot: B.rot }); mkChanged(true); }
  function renderMkBg() { const B = MK.bg, on = !!B.img, P = $('#mkBgCtl'); if (!P) return; P.style.display = on ? '' : 'none'; $('#mkBgClear').disabled = !on; if (!on) { mkBgAdj = false; return; }
    $('#mkBgFit').value = B.fit || 'fill'; const sv = Math.round(B.scale || 100); if (document.activeElement !== $('#mkBgScaleN')) $('#mkBgScaleN').value = sv; $('#mkBgScale').value = Math.max(10, Math.min(400, sv));
    if (document.activeElement !== $('#mkBgX')) $('#mkBgX').value = +toU(+B.ox || 0).toFixed(3); if (document.activeElement !== $('#mkBgY')) $('#mkBgY').value = +toU(+B.oy || 0).toFixed(3);
    $('#mkBgOp').value = Math.round((B.opacity != null ? B.opacity : 1) * 100); $('#mkBgOpV').textContent = $('#mkBgOp').value + '%'; if (document.activeElement !== $('#mkBgDpi')) $('#mkBgDpi').value = B.dpi || 150;
    $('#mkBgAdj').classList.toggle('on', mkBgAdj); $('#mkBgAdj').textContent = mkBgAdj ? '✋ Adjusting background (click to finish)' : '✋ Adjust background (drag to pan)';
    const N = mkBgNat(), R = mkBgRect(); $('#mkBgInfo').textContent = N ? `Image ${N.w} × ${N.h} px (${fmtShort(N.w / (B.dpi || 150))} × ${fmtShort(N.h / (B.dpi || 150))} at ${B.dpi || 150} dpi)${R ? ` · shown ${fmtShort(R.dw)} × ${fmtShort(R.dh)}${R.rot ? ` · turned ${R.rot}°` : ''}` : ''}` : 'Loading image…'; }
  function renderMockCanvas() { const cv = $('#mkCanvas'); if (!cv || $('#tabMock').style.display === 'none') return; const B = MK.bg, box = cv.parentElement, pad = 30;
    const fit = Math.max(8, Math.min((box.clientWidth - 20 - 2 * pad) / B.w, ((window.innerHeight - 170) || 600 - 2 * pad) / B.h)), sc = fit * (MK.zoom || 1);
    mkView = { sc, pad }; cv.width = Math.round(B.w * sc + 2 * pad); cv.height = Math.round(B.h * sc + 2 * pad); cv.style.maxWidth = (MK.zoom || 1) > 1 ? 'none' : '100%';
    const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); mkDraw(g, { sc, pad, mode: MK.guide, ui: true }); $('#mkZoomPct').textContent = Math.round((MK.zoom || 1) * 100) + '%'; }

  // undo / redo (positions, angles, flips, order, visibility, backdrop)
  const mkSizes = () => items.map(it => [it.id, it.wIn, it.hIn, it.pct, it.lockAR]);
  const mkPaints = () => items.filter(i => i.asset).map(i => [i.id, i.dataURL, JSON.stringify(i.asset.recolor || null), JSON.stringify(i.asset.avatar || null)]);
  const mkSig = () => JSON.stringify([mkSizes(), MK.nodes.map(n => [n.uid, n.name, n.itemId, n.x, n.y, n.rot, n.flip, n.hidden, !!n.noNum, n.warp || null]), Object.assign({}, MK.bg, { img: (MK.bg.img || '').length }), MK.skip, MK.num, mkPaints().map(p => [p[0], p[1].length, p[2], p[3]])]);
  const mkSnap = () => ({ sig: mkSig(), sizes: mkSizes(), paints: mkPaints(), nodes: MK.nodes.map(n => Object.assign({}, n)), bg: Object.assign({}, MK.bg), skip: Object.assign({}, MK.skip), num: Object.assign({}, MK.num) });
  function mkCommit() { mkCardNums(); const s = mkSnap(); if (syncItemWarps()) refresh(true); if (mkCur && s.sig === mkCur.sig) { mkAutosave(); if (window.CST && window.CST.bus) window.CST.bus.emit('mockup:changed'); return; } if (mkCur) { mkUndo.push(mkCur); if (mkUndo.length > 100) mkUndo.shift(); mkRedo = []; } mkCur = s; mkAutosave(); if (window.CST && window.CST.bus) window.CST.bus.emit('mockup:changed'); }
  function mkApply(s) { MK.nodes = s.nodes.map(n => Object.assign({}, n)); MK.bg = Object.assign({}, s.bg); MK.skip = Object.assign({}, s.skip); MK.num = Object.assign(mkNumDef(), s.num || {}); mkCur = s; if (mkSel) mkSel = MK.nodes.find(n => n.uid === mkSel.uid) || null; mkAutosave();
    let sized = false; for (const [id, w, h, pct, lock] of s.sizes || []) { const it = items.find(i => i.id === id); if (it && (it.wIn !== w || it.hIn !== h || it.lockAR !== lock)) { it.wIn = w; it.hIn = h; it.pct = pct; it.lockAR = lock; sized = true; } }
    for (const [id, url, rec, av] of s.paints || []) { const it = items.find(i => i.id === id); if (!it || !it.asset) continue; if (it.dataURL !== url) { it.dataURL = url; for (const k of [...cache.keys()]) { try { if (JSON.parse(k)[0] === id) cache.delete(k); } catch (e) { /* not a cache key */ } } loadImg(url).then(im => { it.img = im; refresh(true); }); } it.asset.recolor = JSON.parse(rec); it.asset.avatar = JSON.parse(av); }
    if (sized || syncItemWarps()) refresh(true); else renderMock(true); }
  /** image size is shared with the Layout tab (and every copy on the cut sheet) */
  function mkSetSize(it, wIn, hIn) { it.wIn = Math.max(0.1, wIn); it.hIn = Math.max(0.1, hIn); it.pct = pctOf(it); mkCommit(); refresh(true); }
  function mkPtFromClient(x, y) { const c = $('#mkCanvas'), r = c.getBoundingClientRect(), px = (x - r.left) * (c.width / r.width), py = (y - r.top) * (c.height / r.height); return { x: (px - mkView.pad) / mkView.sc, y: (py - mkView.pad) / mkView.sc }; }
  function sheetPt(x, y) { const c = $('#preview'), r = c.getBoundingClientRect(); return { x: (x - r.left) * (c.width / r.width) / view.sc, y: (y - r.top) * (c.height / r.height) / view.sc }; }
  function layoutHitSelected(x, y) { const e = hitTest(sheetPt(x, y)), s = selEntry(); return !!(e && s && e.key === s.key); }
  function cancelLayoutDrag() { drag = null; }
  function mkLiveSize(it, wIn, hIn) { it.wIn = Math.max(0.1, wIn); it.hIn = Math.max(0.1, hIn); it.pct = pctOf(it); if ($('#tabMock') && $('#tabMock').style.display !== 'none') { renderMockCanvas(); renderMkSel(); } else renderPreview(); }
  function mkLiveRot(n, deg) { mkSetRot(n, deg); renderMockCanvas(); }
  function mkCancelDrag() { mkDrag = null; mkSnapLines = []; }
  function applyChrome() {
    const coarse = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches;
    const big = S.ui && S.ui.bigTargets != null ? !!S.ui.bigTargets : coarse;
    document.documentElement.classList.toggle('big', !!big);
    document.documentElement.classList.toggle('touchui', !!(coarse || big));
  }
  let mkSelectNew = false;
  function mkUndoFn() { if (!mkUndo.length) return; mkRedo.push(mkCur); mkApply(mkUndo.pop()); }
  function mkRedoFn() { if (!mkRedo.length) return; mkUndo.push(mkCur); mkApply(mkRedo.pop()); }
  function mkChanged(full) { mkCommit(); if (full) renderMock(true); else { renderMockCanvas(); renderMkSel(); } }

  // panels
  function renderMock(skipEnsure) {
    const nBefore = MK.nodes.length; if (!skipEnsure && mkEnsure()) mkCommit(); if (!mkCur) mkCur = mkSnap();
    if (mkSelectNew && MK.nodes.length > nBefore) { mkSel = MK.nodes[MK.nodes.length - 1]; mkSelectNew = false; }
    if (JSON.stringify(mkCur.sizes) !== JSON.stringify(mkSizes())) { // a size change made on the Layout tab: adopt it here without an undo step (Layout's own undo covers it)
      const now = new Map(mkSizes().map(r => [r[0], r])), old = new Map((mkCur.sizes || []).map(r => [r[0], r])), ext = [...now.keys()].filter(id => JSON.stringify(now.get(id)) !== JSON.stringify(old.get(id)));
      for (const sn of mkUndo.concat(mkRedo)) sn.sizes = (sn.sizes || []).map(r => ext.includes(r[0]) ? now.get(r[0]) : r);
      mkCur = mkSnap(); }
    mkBgLoad(); const B = MK.bg;
    $('#mkPreset').value = B.preset in MK_PRESETS ? B.preset : 'custom'; $('#mkW').value = +toU(B.w).toFixed(3); $('#mkH').value = +toU(B.h).toFixed(3); $('#mkColor').value = B.color || '#ffffff'; renderMkBg();
    $$('.mku').forEach(e => e.textContent = S.unit); $('#mkGuide').value = MK.guide; $('#mkGhost').value = MK.ghost; $('#mkSnap').checked = MK.snap !== false;
    $('#mkNumShow').value = MK.num.show === 'none' ? 'none' : 'all'; $('#mkNumSize').value = Math.round(+MK.num.size || 100); $('#mkNumSizeV').textContent = $('#mkNumSize').value + '%'; $('#mkNumRow').style.display = MK.guide === 'off' ? 'none' : '';
    $('#mkUndo').disabled = !mkUndo.length; $('#mkRedo').disabled = !mkRedo.length;
    // layers (front first)
    const L = $('#mkLayers'); L.innerHTML = ''; const order = MK.nodes.slice().reverse(), st = mkSteps(), gm = MK.guide !== 'off';
    if (!MK.nodes.length) L.innerHTML = '<div class="empty">No pieces yet. Add images on the Layout tab.</div>';
    for (const n of order) { const it = nodeItem(n), row = document.createElement('div'); row.className = 'lrow' + (n === mkSel ? ' sel' : '') + (n.hidden ? ' hid' : '') + (it ? '' : ' missing'); row.dataset.uid = n.uid;
      const same = it ? MK.nodes.filter(m => nodeItem(m) === it) : [], idx = same.indexOf(n);
      row.innerHTML = `<span class="lhandle" title="Drag to reorder">⋮⋮</span><span class="lnum" title="${st.get(n) ? `Assembly step ${st.get(n)}: #1 (bottom layer) goes on first` : 'Hidden layers get no step'}">${st.get(n) || '–'}</span>${it ? `<img src="${it.dataURL}" alt="">` : '<span class="limg"></span>'}<span class="lname" title="${esc(n.name || '')}">${esc(it ? it.name : (n.name || '?') + ' (image not loaded)')}${same.length > 1 ? ` <span class="muted">(${idx + 1})</span>` : ''}</span>${gm ? `<button class="lnumtog${n.noNum ? ' off' : ''}" title="${n.noNum ? 'Number hidden on the guide (outline and legend still show it). Click to show it.' : 'Hide this number on the guide (keeps the outline, the legend entry and its step)'}">#</button>` : ''}<button class="leye" title="${n.hidden ? 'Show' : 'Hide'}">${n.hidden ? '◌' : '👁'}</button><button class="x" title="Remove from the mockup">✕</button>`;
      row.onclick = (ev) => { if (ev.target.closest('button') || ev.target.closest('.lhandle')) return; mkSelect(n); };
      $('.leye', row).onclick = () => { n.hidden = !n.hidden; if (n.hidden && mkSel === n) mkSel = null; mkChanged(true); };
      $('.x', row).onclick = () => mkDelete(n); if (gm) $('.lnumtog', row).onclick = () => { n.noNum = !n.noNum; mkChanged(true); };
      $('.lhandle', row).addEventListener('pointerdown', (ev) => mkLayerDrag(ev, n, row));
      L.append(row); }
    // add list
    const A = $('#mkAdd'); A.innerHTML = '';
    if (!items.length) A.innerHTML = '<div class="empty">Add images on the Layout tab first.</div>';
    for (const it of items) { const k = MK.nodes.filter(n => nodeItem(n) === it).length, p = processed(it, false), r = document.createElement('div'); r.className = 'arow';
      const bd = stepBadge(it, st); r.innerHTML = `<span class="lnum" title="${esc(bd.tip)}">${esc(bd.t.replace(/#/g, ''))}</span><img src="${it.dataURL}" alt=""><span class="lname">${esc(it.name)}<br><span class="muted">${fmtShort(p.cutW)} × ${fmtShort(p.cutH)} · ${k} in mockup</span></span><button class="mini">+ Add${k ? ' another' : ''}</button>`;
      $('button', r).onclick = () => { const n = mkAdd(it); mkSel = n; mkChanged(true); }; A.append(r); }
    renderMkSel(); renderMockCanvas(); mkPanelSums(); }
  function renderMkSel() { const P = $('#mkSelPanel'), n = mkSel, G = n && ng(n); $('#mkUndo').disabled = !mkUndo.length; $('#mkRedo').disabled = !mkRedo.length;
    P.classList.toggle('idle', !G); $$('#mkSelPanel button, #mkSelPanel input').forEach(b => b.disabled = !G);
    if (!G) { $('#mkWarpNote').style.display = 'none'; $('#mkSelName').textContent = 'Click a piece to select it. Drag to move, drag the round handle to rotate (Shift = 15° steps).'; return; }
    const i = MK.nodes.indexOf(n), sn = mkSteps().get(n); $('#mkSelName').textContent = `${sn ? `Step #${sn}` : 'Hidden'} · ${G.it.name} · ${fmtShort(G.w)} × ${fmtShort(G.h)} · layer ${MK.nodes.length - i} of ${MK.nodes.length}`;
    if (document.activeElement !== $('#mkAngle')) $('#mkAngle').value = +(+n.rot).toFixed(1);
    const it = G.it; if (it.lockAR == null) it.lockAR = true;
    if (document.activeElement !== $('#mkSW')) $('#mkSW').value = +toU(it.wIn).toFixed(4); if (document.activeElement !== $('#mkSH')) $('#mkSH').value = +toU(it.hIn).toFixed(4); if (document.activeElement !== $('#mkSPct')) $('#mkSPct').value = +pctOf(it).toFixed(1);
    const lk = $('#mkSLink'); lk.classList.toggle('on', !!it.lockAR); lk.textContent = it.lockAR ? '🔗' : '⛓︎‍💥'; lk.title = it.lockAR ? 'Aspect ratio locked (corner handles too; hold Shift to unlock while dragging). Click to unlink.' : 'Aspect ratio unlocked: W and H change separately. Click to link.';
    const copies = MK.nodes.filter(m => nodeItem(m) === it).length; $('#mkSizeNote').textContent = `Size applies to every copy of ${it.name} (${copies} here, qty ${it.qty} on the cut sheet) and to the Layout tab. Cut size ${fmtShort(G.w)} × ${fmtShort(G.h)}${isWarped(it) ? `; printed warped: ${fmtShort(processed(it, false).cutW)} × ${fmtShort(processed(it, false).cutH)}` : ''}.`;
    $('#mkFlip').classList.toggle('on', !!n.flip); $('#mkSelNum').checked = !n.noNum;
    const W = n.warp || {}; if (document.activeElement !== $('#mkSkX')) $('#mkSkX').value = +(+W.sx || 0).toFixed(1); if (document.activeElement !== $('#mkSkY')) $('#mkSkY').value = +(+W.sy || 0).toFixed(1);
    const wo = warpOthers(n); $('#mkXfReset').disabled = !isWarped(n); $('#mkWarpNote').style.display = isWarped(n) || mkXf || wo ? '' : 'none';
    $('#mkWarpNote').textContent = 'Warp applies to the printed sticker.' + (wo ? ` ${plural(wo, 'other copy')} of ${G.it.name} ${wo === 1 ? 'has' : 'have'} a different warp: Send to Layout gives ${wo === 1 ? 'it its' : 'them their'} own Layout entry.` : '');
    $$('#mkLayers .lrow').forEach(r => r.classList.toggle('sel', +r.dataset.uid === n.uid)); }
  function mkSelect(n) { mkSel = n; $$('#mkLayers .lrow').forEach(r => r.classList.toggle('sel', n && +r.dataset.uid === n.uid)); const r = n && $(`#mkLayers .lrow[data-uid="${n.uid}"]`); if (r) r.scrollIntoView({ block: 'nearest' }); renderMkSel(); renderMockCanvas(); }
  function mkDelete(n) { const it = nodeItem(n); MK.nodes = MK.nodes.filter(m => m !== n); if (it && !MK.nodes.some(m => nodeItem(m) === it)) MK.skip[it.name] = true; if (mkSel === n) mkSel = null; mkChanged(true); }
  function mkOrder(n, how) { const a = MK.nodes, i = a.indexOf(n); if (i < 0) return; a.splice(i, 1);
    const j = how === 'front' ? a.length : how === 'back' ? 0 : how === 'up' ? Math.min(a.length, i + 1) : Math.max(0, i - 1); a.splice(j, 0, n); mkChanged(true); }
  function mkSetRot(n, deg) { n.rot = ((deg % 360) + 540) % 360 - 180; if (Math.abs(n.rot + 180) < 1e-9) n.rot = 180; }
  function mkLayerDrag(ev, n, row) { ev.preventDefault(); const list = $('#mkLayers'), rows = [...list.querySelectorAll('.lrow')]; row.classList.add('dragging'); let target = rows.indexOf(row);
    const mark = document.createElement('div'); mark.className = 'lmark'; list.append(mark);
    const move = (e) => { const ys = rows.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; }); target = ys.filter(y => e.clientY > y).length; // insert position among rows (front-first)
      const ref = rows[Math.min(target, rows.length - 1)].getBoundingClientRect(), lb = list.getBoundingClientRect(); mark.style.top = ((target >= rows.length ? ref.bottom : ref.top) - lb.top + list.scrollTop - 1) + 'px'; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); mark.remove(); row.classList.remove('dragging');
      const front = MK.nodes.slice().reverse(), from = front.indexOf(n); front.splice(from, 1); const to = target > from ? target - 1 : target; front.splice(Math.max(0, Math.min(front.length, to)), 0, n);
      MK.nodes = front.reverse(); mkChanged(true); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); }

  // canvas interaction
  function mkPt(ev) { const c = $('#mkCanvas'), r = c.getBoundingClientRect(), px = (ev.clientX - r.left) * (c.width / r.width), py = (ev.clientY - r.top) * (c.height / r.height); return { x: (px - mkView.pad) / mkView.sc, y: (py - mkView.pad) / mkView.sc }; }
  function hitR() { return (document.documentElement.classList.contains('big') ? 22 : 9) / (mkView.sc || 1); }
  function mkCornerAt(pt) { const n = mkSel, G = n && !n.hidden && ng(n); if (!G) return null; const dx = pt.x - n.x, dy = pt.y - n.y, c = Math.cos(-rad(n.rot)), s = Math.sin(-rad(n.rot)), lx = dx * c - dy * s, ly = dx * s + dy * c, t = hitR();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (Math.abs(lx - sx * G.w / 2) <= t && Math.abs(ly - sy * G.h / 2) <= t) return [sx, sy]; return null; }
  let mkXf = false;
  /** transform handles in backdrop inches: 4 corners (free distort), then the 4 side middles (top, right, bottom, left: skew) */
  function mkWarpHandles(n, G) { const P = warpQuad(n, G), M = warpMap(n, G), f = M ? M.f : (x, y) => [x, y], w = G.w, h = G.h;
    return P.concat([f(w / 2, 0), f(w, h / 2), f(w / 2, h), f(0, h / 2)]).map(([x, y]) => boxToWorld(n, G, x, y)); }
  /** handle index under the pointer: Transform mode = corners + sides; Ctrl/⌘ outside it = corners (distort) */
  function mkWarpAt(pt, mod) { const n = mkSel, G = n && !n.hidden && ng(n); if (!G || (!mkXf && !mod)) return -1; const H = mkWarpHandles(n, G), t = hitR();
    for (let i = 0; i < (mkXf ? 8 : 4); i++) if (Math.hypot(pt.x - H[i][0], pt.y - H[i][1]) <= t) return i; return -1; }
  /** d = drag state: i (handle), w0 (warp at pointer-down), b0 (pointer in the box frame at pointer-down). Corners follow the pointer; sides skew by the pointer's movement */
  function mkWarpDrag(n, G, d, pt) { const i = d.i, [lx, ly] = toLocal(n, pt.x, pt.y), bx = lx + G.w / 2, by = ly + G.h / 2, w0 = d.w0 || { sx: 0, sy: 0, q: [[0, 0], [0, 0], [0, 0], [0, 0]] }, W = { sx: w0.sx, sy: w0.sy, q: w0.q.map(c => c.slice()) }, w = G.w, h = G.h;
    const deg = (t) => +Math.max(-75, Math.min(75, Math.atan(t) * 180 / Math.PI)).toFixed(2), dx = bx - d.b0[0], dy = by - d.b0[1];
    if (i < 4) { const tx = Math.tan(rad(W.sx)), ty = Math.tan(rad(W.sy)), base = [[0, 0], [w, 0], [w, h], [0, h]][i], sk = [base[0] + tx * (base[1] - h / 2), base[1] + ty * (base[0] - w / 2)]; W.q[i] = [+(bx - sk[0]).toFixed(4), +(by - sk[1]).toFixed(4)]; }
    else if (i === 4 || i === 6) W.sx = deg(Math.tan(rad(w0.sx)) + (i === 4 ? -dx : dx) / (h / 2));
    else W.sy = deg(Math.tan(rad(w0.sy)) + (i === 7 ? -dy : dy) / (w / 2));
    n.warp = warpClean(W); }
  function mkSetXf(v) { mkXf = !!v; const b = $('#mkXf'); if (b) { b.classList.toggle('on', mkXf); b.textContent = mkXf ? '⬚ Transform: on (drag corners / sides)' : '⬚ Transform (skew / distort)'; } renderMockCanvas(); renderMkSel(); }
  function mkOnHandle(pt) { const n = mkSel, G = n && !n.hidden && ng(n); if (!G) return false; const [lx, ly] = toLocal(n, pt.x, pt.y), hy = -G.h / 2 - 24 / mkView.sc; return Math.hypot(n.flip ? -lx : lx, ly - hy) <= hitR(); }
  function mkSnapMove(n, nx, ny, alt) { mkSnapLines = []; if (MK.snap === false || alt) return [nx, ny]; const b = nodeAABB(n), thr = 7 / mkView.sc, hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
    const xs = [0, MK.bg.w / 2, MK.bg.w], ys = [0, MK.bg.h / 2, MK.bg.h];
    for (const m of MK.nodes) { if (m === n || m.hidden) continue; const o = nodeAABB(m); if (!o) continue; xs.push(o.x0, (o.x0 + o.x1) / 2, o.x1); ys.push(o.y0, (o.y0 + o.y1) / 2, o.y1); }
    let bx = null, bd = thr, by = null; for (const x of xs) for (const [off] of [[-hw], [0], [hw]]) { const d = Math.abs(nx + off - x); if (d < bd) { bd = d; bx = [x - off, x]; } }
    bd = thr; for (const y of ys) for (const [off] of [[-hh], [0], [hh]]) { const d = Math.abs(ny + off - y); if (d < bd) { bd = d; by = [y - off, y]; } }
    if (bx) { nx = bx[0]; mkSnapLines.push({ x: bx[1] }); } if (by) { ny = by[0]; mkSnapLines.push({ y: by[1] }); } return [nx, ny]; }
  let mkRaf = false; const mkRedraw = () => { if (mkRaf) return; mkRaf = true; requestAnimationFrame(() => { mkRaf = false; renderMockCanvas(); renderMkSel(); }); };
  function bindMock() {
    const cv = $('#mkCanvas');
    cv.addEventListener('pointerdown', ev => { if (ev.button > 0) return; cv.focus({ preventScroll: true }); const pt = mkPt(ev);
      const wh = mkBgAdj ? -1 : mkWarpAt(pt, ev.ctrlKey || ev.metaKey), corner = mkBgAdj || mkXf || wh >= 0 ? null : mkCornerAt(pt);
      if (wh >= 0) { const n = mkSel, G = ng(n), [lx, ly] = toLocal(n, pt.x, pt.y); mkDrag = { kind: 'warp', n, i: wh, w0: warpClean(n.warp), b0: [lx + G.w / 2, ly + G.h / 2], moved: false }; }
      else if (mkBgAdj && mkBgReady()) mkDrag = { kind: 'bg', px: pt.x, py: pt.y, ox: +MK.bg.ox || 0, oy: +MK.bg.oy || 0, moved: false };
      else if (corner) { const n = mkSel, G = ng(n); mkDrag = { kind: 'size', n, it: G.it, sx: corner[0], sy: corner[1], w: G.w, h: G.h, cx: n.x, cy: n.y, moved: false }; }
      else if (!mkXf && mkOnHandle(pt)) { const n = mkSel; mkDrag = { kind: 'rot', n, a0: Math.atan2(pt.y - n.y, pt.x - n.x), r0: n.rot }; }
      else { const n = mkHit(pt.x, pt.y); mkSelect(n); if (!n) return; mkDrag = { kind: 'move', n, dx: pt.x - n.x, dy: pt.y - n.y, moved: false, sx: ev.clientX, sy: ev.clientY }; }
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ } ev.preventDefault(); });
    cv.addEventListener('pointermove', ev => { const pt = mkPt(ev);
      if (!mkDrag && mkBgAdj) { cv.style.cursor = 'move'; return; }
      if (mkDrag && mkDrag.kind === 'bg') { MK.bg.ox = +(mkDrag.ox + pt.x - mkDrag.px).toFixed(4); MK.bg.oy = +(mkDrag.oy + pt.y - mkDrag.py).toFixed(4); mkDrag.moved = true; mkRedraw(); renderMkBg(); return; }
      if (!mkDrag && mkWarpAt(pt, ev.ctrlKey || ev.metaKey) >= 0) { cv.style.cursor = 'move'; return; }
      if (!mkDrag) { const cr = mkCornerAt(pt); cv.style.cursor = cr ? (cr[0] * cr[1] > 0 ? 'nwse-resize' : 'nesw-resize') : mkOnHandle(pt) ? 'crosshair' : mkHit(pt.x, pt.y) ? 'grab' : 'default'; return; }
      const d = mkDrag, n = d.n;
      if (d.kind === 'warp') { const G = ng(n); if (G) { mkWarpDrag(n, G, d, pt); d.moved = true; mkRedraw(); } return; }
      if (d.kind === 'size') { // opposite corner stays put; locked = scale along the diagonal, unlocked = free W/H
        const c = Math.cos(-rad(n.rot)), s = Math.sin(-rad(n.rot)), dx = pt.x - d.cx, dy = pt.y - d.cy, lx = dx * c - dy * s, ly = dx * s + dy * c, ax = -d.sx * d.w / 2, ay = -d.sy * d.h / 2, vx = lx - ax, vy = ly - ay, mn = 0.15;
        const lock = (d.it.lockAR !== false) !== !!ev.shiftKey; let W, H;
        if (lock) { const ddx = d.sx * d.w, ddy = d.sy * d.h, k = Math.max(mn / Math.min(d.w, d.h), (vx * ddx + vy * ddy) / (ddx * ddx + ddy * ddy)); W = d.w * k; H = d.h * k; }
        else { W = Math.max(mn, vx * d.sx); H = Math.max(mn, vy * d.sy); }
        const mx = ax + d.sx * W / 2, my = ay + d.sy * H / 2, C2 = Math.cos(rad(n.rot)), S2 = Math.sin(rad(n.rot));
        n.x = d.cx + mx * C2 - my * S2; n.y = d.cy + mx * S2 + my * C2; n._rs = [W / d.w, H / d.h]; d.W = W; d.H = H; d.lock = lock; d.moved = true; mkRedraw(); return; }
      if (d.kind === 'rot') { let a = d.r0 + (Math.atan2(pt.y - n.y, pt.x - n.x) - d.a0) * 180 / Math.PI; if (ev.shiftKey) a = Math.round(a / 15) * 15; mkSetRot(n, a); d.moved = true; mkRedraw(); return; }
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 3) return; d.moved = true; cv.style.cursor = 'grabbing';
      let nx = Math.max(0, Math.min(MK.bg.w, pt.x - d.dx)), ny = Math.max(0, Math.min(MK.bg.h, pt.y - d.dy)); [nx, ny] = mkSnapMove(n, nx, ny, ev.altKey); n.x = nx; n.y = ny; mkRedraw(); });
    const end = () => { if (!mkDrag) return; const d = mkDrag; mkDrag = null; mkSnapLines = []; cv.style.cursor = 'default';
      if (d.kind === 'size') { delete d.n._rs; if (!d.moved) { renderMockCanvas(); return; } const it = d.it, off = 2 * (it.offsetIn || 0), f = (cut0, cut1) => Math.max(0.05, (cut1 - off) / Math.max(0.05, cut0 - off));
        const wIn = it.wIn * f(d.w, d.W), hIn = d.lock ? wIn * it.hIn / it.wIn : it.hIn * f(d.h, d.H); mkSetSize(it, wIn, hIn); return; }
      if (d.moved) mkChanged(false); else renderMockCanvas(); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', ev => { if (!ev.ctrlKey) return; ev.preventDefault(); mkZoom((MK.zoom || 1) * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    document.addEventListener('keydown', ev => { if ($('#tabMock').style.display === 'none') return;
      const tg = ev.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable), mod = ev.ctrlKey || ev.metaKey, k = ev.key;
      if (mod && (k === 's' || k === 'S')) { ev.preventDefault(); mkQuickSave(); return; }
      if (mkXf && k === 'Escape' && !typing) { mkSetXf(false); return; }
      if (mkBgAdj && k === 'Escape' && !typing) { mkBgAdj = false; renderMkBg(); renderMockCanvas(); return; }
      if (mod && !typing && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? mkRedoFn() : mkUndoFn(); return; }
      if (mod && !typing && k.toLowerCase() === 'y') { ev.preventDefault(); mkRedoFn(); return; }
      if (typing || mod) return; const n = mkSel; if (k === 'Escape') { mkSelect(null); return; } if (!n) return;
      const st = (S.unit === 'mm' ? 1 / 25.4 : 1 / 16) * (ev.shiftKey ? 4 : 1), mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[k];
      if (mv) { ev.preventDefault(); n.x += mv[0]; n.y += mv[1]; mkChanged(false); }
      else if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); mkDelete(n); }
      else if (k === 'r' || k === 'R') { ev.preventDefault(); mkSetRot(n, Math.round((n.rot + (ev.shiftKey ? -15 : 15)) / 15) * 15); mkChanged(false); }
      else if (k === 'f' || k === 'F') { ev.preventDefault(); n.flip = !n.flip; mkChanged(false); }
      else if (k === 'd' || k === 'D') { ev.preventDefault(); const it = nodeItem(n); if (it) { mkSel = mkAdd(it, n); mkChanged(true); } }
      else if (k === ']' || k === '}') { ev.preventDefault(); mkOrder(n, ev.shiftKey || k === '}' ? 'front' : 'up'); }
      else if (k === '[' || k === '{') { ev.preventDefault(); mkOrder(n, ev.shiftKey || k === '{' ? 'back' : 'down'); } });
    const sel = (f) => () => { if (mkSel) f(mkSel); };
    $('#mkFront').onclick = sel(n => mkOrder(n, 'front')); $('#mkFwd').onclick = sel(n => mkOrder(n, 'up')); $('#mkBack').onclick = sel(n => mkOrder(n, 'down')); $('#mkToBack').onclick = sel(n => mkOrder(n, 'back'));
    $('#mkFlip').onclick = sel(n => { n.flip = !n.flip; mkChanged(false); });
    $('#mkRotL').onclick = sel(n => { mkSetRot(n, n.rot - 15); mkChanged(false); }); $('#mkRotR').onclick = sel(n => { mkSetRot(n, n.rot + 15); mkChanged(false); }); $('#mkRot0').onclick = sel(n => { n.rot = 0; mkChanged(false); });
    $('#mkAngle').addEventListener('change', sel(n => { const v = parseFloat($('#mkAngle').value); if (isFinite(v)) { mkSetRot(n, v); mkChanged(false); } }));
    $('#mkDup').onclick = sel(n => { const it = nodeItem(n); if (it) { mkSel = mkAdd(it, n); mkChanged(true); } }); $('#mkDel').onclick = sel(n => mkDelete(n));
    const selIt = () => mkSel && nodeItem(mkSel);
    $('#mkSW').addEventListener('change', () => { const it = selIt(), v = fromU(parseFloat($('#mkSW').value)); if (!it || !(v > 0)) return; mkSetSize(it, v, it.lockAR !== false ? Math.max(0.1, v) * it.hIn / it.wIn : it.hIn); });
    $('#mkSH').addEventListener('change', () => { const it = selIt(), v = fromU(parseFloat($('#mkSH').value)); if (!it || !(v > 0)) return; mkSetSize(it, it.lockAR !== false ? Math.max(0.1, v) * it.wIn / it.hIn : it.wIn, v); });
    $('#mkSPct').addEventListener('change', () => { const it = selIt(), v = parseFloat($('#mkSPct').value); if (!it || !(v > 0)) return; setPct(it, v); mkCommit(); refresh(true); });
    $$('#mkSelPanel .pp[data-p]').forEach(b => b.onclick = () => { const it = selIt(); if (!it) return; setPct(it, +b.dataset.p); mkCommit(); refresh(true); });
    $('#mkSLink').onclick = () => { const it = selIt(); if (!it) return; it.lockAR = it.lockAR === false; mkCommit(); refresh(true); };
    const md = $('#mkDrop'), mf = $('#mkFile');
    md.addEventListener('click', () => mf.click()); mf.addEventListener('change', () => { mkSelectNew = true; handleFiles(Array.from(mf.files)); mf.value = ''; });
    ['dragenter', 'dragover'].forEach(e => md.addEventListener(e, ev => { ev.preventDefault(); md.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => md.addEventListener(e, () => { md.classList.remove('over'); mkSelectNew = true; })); // the page-wide drop handler adds the files
    $('#mkUndo').onclick = mkUndoFn; $('#mkRedo').onclick = mkRedoFn;
    $('#mkZoomIn').onclick = () => mkZoom((MK.zoom || 1) * 1.25); $('#mkZoomOut').onclick = () => mkZoom((MK.zoom || 1) / 1.25); $('#mkZoomFit').onclick = () => mkZoom(1);
    $('#mkSnap').onchange = () => { MK.snap = $('#mkSnap').checked; mkAutosave(); };
    $('#mkGuide').onchange = () => { MK.guide = $('#mkGuide').value; mkAutosave(); renderMock(true); };
    $('#mkNumShow').onchange = () => { MK.num.show = $('#mkNumShow').value; mkChanged(true); };
    $('#mkNumSize').oninput = () => { MK.num.size = +$('#mkNumSize').value; $('#mkNumSizeV').textContent = MK.num.size + '%'; renderMockCanvas(); }; $('#mkNumSize').onchange = () => { MK.num.size = +$('#mkNumSize').value; mkChanged(false); };
    $('#mkNumAll').onclick = () => { MK.nodes.forEach(n => { n.noNum = false; }); MK.num.show = 'all'; mkChanged(true); };
 $('#mkXf').onclick = () => mkSetXf(!mkXf);
    const skew = (k) => () => { if (!mkSel) return; const v = parseFloat($(k === 'sx' ? '#mkSkX' : '#mkSkY').value); if (!isFinite(v)) return; mkSel.warp = warpClean(Object.assign({ sx: 0, sy: 0, q: [] }, mkSel.warp, { [k]: v })); mkChanged(false); };
    $('#mkSkX').onchange = skew('sx'); $('#mkSkY').onchange = skew('sy');
    $('#mkXfReset').onclick = () => { if (mkSel && mkSel.warp) { mkSel.warp = null; mkChanged(false); } };
    $('#mkSelNum').onchange = () => { if (mkSel) { mkSel.noNum = !$('#mkSelNum').checked; mkChanged(true); } };
    $('#mkGhost').oninput = () => { MK.ghost = +$('#mkGhost').value; mkAutosave(); renderMockCanvas(); };
    $('#mkPreset').onchange = () => { const v = $('#mkPreset').value, P = MK_PRESETS[v]; MK.bg.preset = v; if (P && P[1]) { MK.bg.w = P[1]; MK.bg.h = P[2]; } mkChanged(true); };
    const dim = (k) => () => { const v = fromU(parseFloat($(k === 'w' ? '#mkW' : '#mkH').value)); if (isFinite(v) && v >= 1 && v <= 120) { MK.bg[k] = v; MK.bg.preset = 'custom'; mkChanged(true); } };
    $('#mkW').onchange = dim('w'); $('#mkH').onchange = dim('h');
    $('#mkColor').oninput = () => { MK.bg.color = $('#mkColor').value; renderMockCanvas(); }; $('#mkColor').onchange = () => { MK.bg.color = $('#mkColor').value; mkChanged(false); };
    $('#mkBgImg').onclick = () => $('#mkBgFile').click(); $('#mkBgClear').onclick = () => { MK.bg.img = null; MK.bg.imgName = null; mkBgAdj = false; mkChanged(true); };
    $('#mkBgFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const u = await readAsDataURL(f); MK.bg.img = u; MK.bg.imgName = f.name; Object.assign(MK.bg, MK_BG_RESET, { dpi: imgDpi(u) || 150 }); mkChanged(true); };
    const bgLive = (fn) => () => { fn(); renderMockCanvas(); renderMkBg(); }, bgSet = (fn) => () => { fn(); mkChanged(false); renderMkBg(); };
    const num = (id) => parseFloat($(id).value);
    $('#mkBgFit').onchange = bgSet(() => { MK.bg.fit = $('#mkBgFit').value; });
    $('#mkBgScale').oninput = bgLive(() => { MK.bg.scale = num('#mkBgScale'); }); $('#mkBgScale').onchange = bgSet(() => { MK.bg.scale = num('#mkBgScale'); });
    $('#mkBgScaleN').onchange = bgSet(() => { const v = num('#mkBgScaleN'); if (isFinite(v) && v >= 1 && v <= 2000) MK.bg.scale = v; });
    $$('#mkBgCtl .bgp').forEach(b => b.onclick = bgSet(() => { MK.bg.scale = +b.dataset.p; }));
    $('#mkBgX').onchange = bgSet(() => { const v = fromU(num('#mkBgX')); if (isFinite(v)) MK.bg.ox = v; }); $('#mkBgY').onchange = bgSet(() => { const v = fromU(num('#mkBgY')); if (isFinite(v)) MK.bg.oy = v; });
    $('#mkBgOp').oninput = bgLive(() => { MK.bg.opacity = num('#mkBgOp') / 100; }); $('#mkBgOp').onchange = bgSet(() => { MK.bg.opacity = num('#mkBgOp') / 100; });
    $('#mkBgDpi').onchange = bgSet(() => { const v = num('#mkBgDpi'); if (isFinite(v) && v >= 10 && v <= 2400) MK.bg.dpi = v; });
    $('#mkBgRot').onclick = bgSet(() => { MK.bg.rot = ((+MK.bg.rot || 0) + 90) % 360; });
    $('#mkBgCenter').onclick = bgSet(() => { MK.bg.ox = 0; MK.bg.oy = 0; });
    $('#mkBgReset').onclick = bgSet(() => { Object.assign(MK.bg, MK_BG_RESET); });
    $('#mkBgAdj').onclick = () => { mkBgAdj = !mkBgAdj; renderMkBg(); renderMockCanvas(); };
    $('#mkBgToSize').onclick = () => mkBgToBackdrop('dpi'); $('#mkBgAspect').onclick = () => mkBgToBackdrop('width');
    $('#mkFit').onclick = mkFitBackdrop; $('#mkArrange').onclick = () => { const live = mkLive(); MK.nodes = MK.nodes.filter(n => !nodeItem(n)); for (const n of live) { const G = ng(n), c = Math.abs(Math.cos(rad(n.rot))), s = Math.abs(Math.sin(rad(n.rot))), sp = mkFreeSpot(G.w * c + G.h * s, G.w * s + G.h * c); n.x = sp.x; n.y = sp.y; MK.nodes.push(n); } mkChanged(true); };
    bindMkPanels(); bindMkStore();
    $('#mkSend').onclick = mkSendOpen; $('#mkSendCancel').onclick = () => $('#mkSendDlg').close();
    $('#mkSendOk').onclick = () => { const D = $('#mkSendDlg'), P = D._plan; D.close(); mkSendApply(P); };
    $('#mkExpPNG').onclick = () => download(`${mkBase()}-MOCKUP.png`, dataURLBlob(mockPNG()));
    $('#mkExpGuidePNG').onclick = () => download(`${mkBase()}-ASSEMBLY-GUIDE.png`, dataURLBlob(guidePNG()));
    $('#mkExpGuidePDF').onclick = () => { try { saveBlob(`${mkBase()}-ASSEMBLY-GUIDE.pdf`, guidePDF().output('blob')); } catch (e) { alert(e.message); } };
    window.addEventListener('resize', () => renderMockCanvas()); }
  // ---------- Send to Layout: the Layout's image list becomes exactly the pieces in the Layers list ----------
  /** plan: kept images with qty = number of layer copies (hidden layers only when included), images with only hidden layers -> qty 0 (kept so those layers still show), images with no layer -> removed */
  function mkSendPlan(incHidden) { const cnt = new Map();
    for (const n of MK.nodes) { const it = nodeItem(n); if (!it) continue; const c = cnt.get(it) || { k: 0, hid: 0, flip: 0, g: new Map(), hn: [] }; cnt.set(it, c); if (n.hidden && !incHidden) { c.hid++; c.hn.push(n); }
      else { c.k++; if (n.flip) c.flip++; const s = isWarped(n) ? warpSig(n.warp) : '', gr = c.g.get(s) || { s, k: 0, nodes: [] }; gr.k++; gr.nodes.push(n); c.g.set(s, gr); } }
    // copies with different warps: the group matching the image's warp keeps the image, every other group becomes its own Layout entry
    const keep = [], zero = [], removed = [], splits = []; for (const it of items) { const c = cnt.get(it); if (!c) removed.push(it); else if (c.k) { const gs = [...c.g.values()], main = c.g.get(isWarped(it) ? warpSig(it.warp) : '') || gs.reduce((a, b) => b.k > a.k ? b : a);
        keep.push({ it, k: main.k, from: it.qty, warp: main.s }); let wn = 1;
        for (const gr of gs) if (gr !== main) splits.push({ it, k: gr.k, warp: gr.s, nodes: gr.nodes.concat(c.hn.filter(n => (isWarped(n) ? warpSig(n.warp) : '') === gr.s)), name: `${it.name} (${gr.s ? 'warped ' + (++wn) : 'unwarped'})` }); }
      else zero.push(it); }
    return { keep, zero, removed, splits, images: keep.length + splits.length, pieces: keep.reduce((t, r) => t + r.k, 0) + splits.reduce((t, r) => t + r.k, 0), flipped: [...cnt.values()].reduce((t, c) => t + c.flip, 0), hiddenSkipped: [...cnt.values()].reduce((t, c) => t + c.hid, 0), incHidden: !!incHidden }; }
  const plural = (n, w) => `${n} ${n === 1 ? w : /y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'}`;
  function mkSendSummary(P) { const parts = [`Layout will have <b>${plural(P.images, 'image')}, ${plural(P.pieces, 'piece')}</b>`];
    if (P.removed.length) parts.push(`${plural(P.removed.length, 'image')} removed`); if (P.zero.length) parts.push(`${plural(P.zero.length, 'image')} set to qty 0 (only hidden layers)`);
    const ch = P.keep.filter(r => r.k !== r.from).length; if (ch) parts.push(`${plural(ch, 'quantity')} changed`); return parts.join('; ') + '.'; }
  function mkSendOpen() { const P = mkSendPlan($('#mkSendHidden').checked), D = $('#mkSendDlg');
    $('#mkSendSum').innerHTML = P.pieces ? mkSendSummary(P) : '<b>Nothing to send:</b> there are no ' + (P.incHidden ? '' : 'visible ') + 'pieces in the Layers list.';
    const li = []; for (const r of P.keep) { li.push(`<li>${esc(r.it.name)} × ${r.k} <span class="muted">· ${fmtShort(r.it.wIn)} × ${fmtShort(r.it.hIn)}${r.k !== r.from ? ` · qty ${r.from} → ${r.k}` : ''}</span></li>`); }
    for (const r of P.splits) li.push(`<li>${esc(r.name)} × ${r.k} <span class="muted">· new entry: ${r.warp ? 'these copies have their own warp' : 'unwarped copies'}</span></li>`);
    for (const it of P.zero) li.push(`<li class="zero">${esc(it.name)} · qty ${it.qty} → 0 (hidden layer${MK.nodes.filter(n => nodeItem(n) === it).length > 1 ? 's' : ''} only)</li>`);
    for (const it of P.removed) li.push(`<li><span class="gone">${esc(it.name)}</span> <span class="muted">· removed (not in the layers)</span></li>`);
    $('#mkSendList').innerHTML = li.join('');
    $('#mkSendNote').textContent = [P.hiddenSkipped && !P.incHidden ? `${plural(P.hiddenSkipped, 'hidden layer')} not counted (tick "Include hidden layers" to count them).` : '', 'Hand-placed pieces are reset and the Layout auto-packs again.', 'Sizes and warps carry over; mockup rotation is not used (the packer rotates pieces as it needs to)' + (P.flipped ? ` and ${plural(P.flipped, 'flipped piece')} will print unflipped.` : '.'), 'Undo with Ctrl+Z or Undo on the Layout tab.'].filter(Boolean).join(' ');
    $('#mkSendOk').disabled = !P.pieces; D._plan = P; if (D.showModal) D.showModal(); else D.setAttribute('open', ''); }
  function mkSendApply(P) { if (!P || !P.pieces) return false; items = items.filter(it => !P.removed.includes(it)); for (const r of P.keep) { r.it.qty = r.k; r.it.warp = r.warp ? JSON.parse(r.warp) : null; } for (const it of P.zero) it.qty = 0;
    for (const sp of (P.splits || []).slice().reverse()) { const ni = Object.assign({}, sp.it, { id: nextId++, name: sp.name, qty: sp.k, warp: sp.warp ? JSON.parse(sp.warp) : null, collapsed: false });
      items.splice(items.indexOf(sp.it) + 1, 0, ni); for (const n of sp.nodes) { n.itemId = ni.id; n.name = ni.name; } }
    if (P.splits && P.splits.length) mkCommit();
    manual = null; sel = { key: null, itemId: null }; curSheet = 0; const tb = $('.tabs button[data-tab=tabLayout]'); if (tb) tb.click(); refresh(true);
    toast(`Layout now has ${plural(P.images, 'image')}, ${plural(P.pieces, 'piece')} from the mockup (Ctrl+Z to undo)`); return true; }
  function mkZoom(z) { MK.zoom = Math.max(0.5, Math.min(4, z)); if (Math.abs(MK.zoom - 1) < 0.03) MK.zoom = 1; renderMockCanvas(); }
  function mkFitBackdrop() { const bs = mkLive().filter(n => !n.hidden).map(n => nodeAABB(n)); if (!bs.length) return; const m = 0.5, x0 = Math.min(...bs.map(b => b.x0)) - m, y0 = Math.min(...bs.map(b => b.y0)) - m, x1 = Math.max(...bs.map(b => b.x1)) + m, y1 = Math.max(...bs.map(b => b.y1)) + m;
    for (const n of MK.nodes) { n.x -= x0; n.y -= y0; } MK.bg.w = +(x1 - x0).toFixed(3); MK.bg.h = +(y1 - y0).toFixed(3); MK.bg.preset = 'custom'; mkChanged(true); }
  const mkBase = () => 'mockup-' + (MK.bg.w).toFixed(2).replace(/\.?0+$/, '') + 'x' + (MK.bg.h).toFixed(2).replace(/\.?0+$/, '') + 'in';
  function dataURLBlob(u) { const [h, b64] = u.split(','), bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: /:(.*?);/.exec(h)[1] }); }
  function mkRaster(mode, dpi, extraH) { const B = MK.bg, sc = Math.min(dpi, 5000 / Math.max(B.w, B.h)), c = document.createElement('canvas'); c.width = Math.round(B.w * sc); c.height = Math.round(B.h * sc) + (extraH ? Math.round(extraH * sc) : 0);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); mkDraw(g, { sc, pad: 0, mode, ui: false }); return { c, g, sc }; }
  const guideMode = () => MK.guide === 'off' ? 'outline' : MK.guide;
  /** one row per assembly step, in order: step, image, size; noNum = its number is hidden on the picture */
  function legendRows() { const out = []; for (const [n, k] of mkSteps()) { const it = nodeItem(n), p = processed(it, false); out.push({ n: k, it, node: n, w: p.cutW, h: p.cutH, noNum: MK.num.show === 'none' || !!n.noNum }); } return out; }
  const legendNote = (r) => r.noNum ? ' (number not shown on the picture)' : '';
  function mockPNG() { return mkRaster('off', 150).c.toDataURL('image/png'); }
  function guidePNG() { const rows = legendRows(), B = MK.bg, lh = 0.36, cols = B.w >= 6 ? 2 : 1, extra = 0.62 + Math.ceil(rows.length / cols) * lh, r = mkRaster(guideMode(), 150, extra), g = r.g, sc = r.sc;
    g.save(); g.scale(sc, sc); g.translate(0, B.h); g.fillStyle = '#fff'; g.fillRect(0, 0, B.w, extra); g.strokeStyle = '#999'; g.lineWidth = 1 / sc; g.beginPath(); g.moveTo(0, 0.02); g.lineTo(B.w, 0.02); g.stroke();
    g.fillStyle = '#1d2733'; g.font = `bold ${0.17}px sans-serif`; g.textBaseline = 'middle'; g.fillText(`Assembly guide: stick them on in order, #1 first (bottom layer) to #${rows.length} last (top)`, 0.2, 0.22);
    g.font = `${0.12}px sans-serif`; g.fillStyle = '#5b6573'; g.fillText('Each copy has its own step. "Print piece numbers" on the Layout tab prints the same numbers on the cut sheet.', 0.2, 0.43);
    rows.forEach((r, i) => { const x = 0.2 + (i % cols) * (B.w / cols), y = 0.62 + Math.floor(i / cols) * lh + lh / 2, t = String(r.n), rr = 0.1 * badgeK(t);
      g.beginPath(); g.arc(x + 0.13, y, rr, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#2b2f36'; g.lineWidth = 1.2 / sc; g.stroke();
      g.font = `bold ${0.13}px sans-serif`; g.fillStyle = '#1d2733'; g.textAlign = 'center'; g.fillText(t, x + 0.13, y + 0.005); g.textAlign = 'left';
      const p = processed(r.it, false), k = Math.min(0.28 / p.cutW, 0.28 / p.cutH); g.save(); g.translate(x + 0.5 - p.cutW * k / 2, y - p.cutH * k / 2); g.scale(k, k); g.drawImage(p.print.canvas, p.print.x, p.print.y, p.print.w, p.print.h); g.restore();
      g.font = `${0.14}px sans-serif`; g.fillStyle = '#1d2733'; g.fillText(r.it.name, x + 0.72, y - 0.05); g.font = `${0.11}px sans-serif`; g.fillStyle = '#6b7380'; g.fillText(`${fmtShort(r.w)} × ${fmtShort(r.h)}${legendNote(r)}`, x + 0.72, y + 0.1); });
    g.restore(); return r.c.toDataURL('image/png'); }
  /** printable true-size guide: page = backdrop. Vector numbered outlines (+ faint images when "ghosted"), legend on page 2. Uses the print compensation when calibration is on, so it measures true size on paper. */
  function guidePDF() { const B = MK.bg, live = mkLive().filter(n => !n.hidden); if (!live.length) throw new Error('Nothing in the mockup yet.');
    const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: [B.w * PT, B.h * PT], orientation: B.w > B.h ? 'landscape' : 'portrait', compress: true });
    const k = activeComp(), P = C.printMap(k.ex, k.ey, B.w / 2, B.h / 2), mode = guideMode();
    if (mode === 'ghost' || B.img) { const r = document.createElement('canvas'), sc = Math.min(150, 4000 / Math.max(B.w, B.h)); r.width = Math.round(B.w * sc); r.height = Math.round(B.h * sc); const g = r.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, r.width, r.height);
      const keepC = B.color; B.color = '#ffffff'; mkDraw(g, { sc, pad: 0, mode: mode === 'ghost' ? 'ghost' : 'bgonly', noMarks: true, ui: false, ghost: Math.min(MK.ghost, 0.35) }); B.color = keepC;
      const [a, b] = P(0, 0); doc.addImage(r.toDataURL('image/jpeg', 0.85), 'JPEG', a * PT, b * PT, B.w * k.ex * PT, B.h * k.ey * PT, 'ghost', 'FAST'); }
    doc.setDrawColor(40); doc.setLineWidth(0.8); doc.setLineDashPattern([3, 2], 0);
    for (const n of live) { const G = ng(n), c = Math.cos(rad(n.rot)), s = Math.sin(rad(n.rot));
      const WM = warpMap(n, G), T = (lx, ly) => { if (WM) [lx, ly] = WM.f(lx, ly); lx -= G.w / 2; ly -= G.h / 2; if (n.flip) lx = -lx; const x = n.x + lx * c - ly * s, y = n.y + lx * s + ly * c, [a, b] = P(x, y); return [a * PT, b * PT]; };
      for (const poly of flatLoops(G.p)) { if (poly.length < 2) continue; const pts = poly.map(([x, y]) => T(x, y)), d = []; for (let i = 1; i < pts.length; i++) d.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]); doc.lines(d, pts[0][0], pts[0][1], [1, 1], 'S', true); } }
    doc.setLineDashPattern([], 0); doc.setLineWidth(0.8);
    const st = mkSteps(), ns = mkNumScale(), allG = live.map(n => [n, ng(n)]), shown = MK.num.show === 'none' ? [] : allG.filter(([n]) => !n.noNum), npos = mkNumPos(shown, 0.125 * ns, allG);
    for (const [n] of shown) { const t = String(st.get(n)), [a, b] = P(...npos.get(n)), r = 0.105 * badgeK(t) * ns * PT; doc.setFillColor(255, 255, 255); doc.circle(a * PT, b * PT, r, 'FD'); doc.setFontSize(10 * ns); doc.setTextColor(20); doc.text(t, a * PT, b * PT + 3.4 * ns, { align: 'center' }); }
    // legend page (Letter)
    doc.addPage([8.5 * PT, 11 * PT], 'portrait'); doc.setTextColor(20); doc.setFontSize(15); doc.text('Assembly guide – legend', 0.6 * PT, 0.8 * PT); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`Page 1 is the scene at true size (${B.w.toFixed(2)} × ${B.h.toFixed(2)} in${k.ex !== 1 || k.ey !== 1 ? `, enlarged ${fmtPct(k.ex - 1)} / ${fmtPct(k.ey - 1)} for your calibrated printer` : ''}). Print at 100% / Actual size.`, 0.6 * PT, 1.08 * PT, { maxWidth: 7.3 * PT });
    doc.text('Stick them on in order: #1 first (the bottom layer), the highest number last (the top), so every sticker goes over the ones it overlaps. Each copy has its own step. Turn on "Print piece numbers" on the Layout tab to print the same step numbers next to the stickers on the cut sheet (copies of one image take its steps in reading order: sheet 1 first, top to bottom, left to right).', 0.6 * PT, 1.36 * PT, { maxWidth: 7.3 * PT });
    let y = 2.2; for (const r of legendRows()) { if (y > 10.4) { doc.addPage([8.5 * PT, 11 * PT], 'portrait'); y = 0.8; }
      doc.setDrawColor(40); doc.setFillColor(255, 255, 255); doc.circle(0.8 * PT, y * PT, 0.13 * badgeK(String(r.n)) * PT, 'FD'); doc.setFontSize(10); doc.setTextColor(20); doc.text(String(r.n), 0.8 * PT, y * PT + 3.4, { align: 'center' });
      try { const pr = processed(r.it, false), k2 = Math.min(0.5 / pr.cutW, 0.5 / pr.cutH); doc.addImage(canvasURL(pr), pr.print.hasAlpha ? 'PNG' : 'JPEG', 1.1 * PT, (y - 0.25) * PT, pr.print.w * k2 * PT, pr.print.h * k2 * PT, undefined, 'FAST'); } catch (e) { /* thumbnail optional */ }
      const pr = processed(r.it, false); doc.setFontSize(11); doc.text(`Step ${r.n}: ${r.it.name}`, 1.8 * PT, y * PT + 1); doc.setFontSize(8); doc.setTextColor(110); doc.text(`${fmtShort(pr.cutW)} × ${fmtShort(pr.cutH)}${legendNote(r)}`, 1.8 * PT, y * PT + 11);
      y += 0.62; }
    doc.setTextColor(0); doc.setDrawColor(0); doc.setFillColor(0); return doc; }
  // ---------- Mockup panels: collapsible, with a one-line summary when collapsed (state kept in the settings) ----------
  const MK_PANELS = ['back', 'layers', 'images', 'guide', 'save'];
  function mkPanelSum(k) { const B = MK.bg;
    if (k === 'back') { const pr = MK_PRESETS[B.preset], fitL = { fit: 'Fit', fill: 'Fill', stretch: 'Stretch', original: 'True size', tile: 'Tile' }[B.fit || 'fill'];
      return `${pr && pr[1] ? pr[0] : 'Custom ' + fmtShort(B.w) + ' × ' + fmtShort(B.h)}${B.img ? ` · bg: ${B.imgName || 'image'} ${fitL}` : ''}`; }
    if (k === 'layers') { const h = MK.nodes.filter(n => n.hidden).length; return `${plural(MK.nodes.length, 'layer')}${h ? ` · ${h} hidden` : ''}`; }
    if (k === 'images') return plural(items.length, 'image');
    if (k === 'guide') return `${MK.guide === 'off' ? 'Finished mockup' : MK.guide === 'ghost' ? 'Guide: ghost' : 'Guide: outlines'} · numbers ${MK.num.show === 'none' ? 'none' : 'all'}${MK.nodes.some(n => n.noNum) && MK.num.show !== 'none' ? ` (${MK.nodes.filter(n => n.noNum).length} hidden)` : ''}${(+MK.num.size || 100) !== 100 ? ` · size ${MK.num.size}%` : ''}`;
    if (k === 'save') return mkStoreState.last ? `saved “${mkStoreState.last.name}” ${new Date(mkStoreState.last.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : mkStoreState.auto ? 'autosaved in this browser' : '';
    return ''; }
  function mkPanelSums() { const C = S.mkCol || {}; for (const k of MK_PANELS) { const P = document.querySelector(`.panel[data-col="${k}"]`); if (!P) continue; const sm = $('.psum', P); if (sm && sm.dataset.hint == null) sm.dataset.hint = sm.textContent; if (sm) sm.textContent = C[k] ? mkPanelSum(k) : (sm.dataset.hint || ''); } }
  function setMkCol(k, v) { S.mkCol = Object.assign({}, S.mkCol, { [k]: !!v }); const P = document.querySelector(`.panel[data-col="${k}"]`); if (!P) return; P.classList.toggle('collapsed', !!v); const b = $('.pchev', P); b.setAttribute('aria-expanded', String(!v)); b.title = v ? 'Expand' : 'Collapse'; mkPanelSums(); }
  function bindMkPanels() { for (const k of MK_PANELS) { const P = document.querySelector(`.panel[data-col="${k}"]`); if (!P) continue; const sm = $('.psum', P); if (sm && sm.dataset.hint == null) sm.dataset.hint = sm.textContent;
      $('h2', P).onclick = (ev) => { if (ev.target.closest('a,input,select')) return; setMkCol(k, !(S.mkCol || {})[k]); saveSettings(); if (!S.mkCol[k]) renderMockCanvas(); };
      setMkCol(k, !!(S.mkCol || {})[k]); } }

  // ---------- Mockup saves: file (= project format, images embedded), named saves + autosave in IndexedDB ----------
  const IDB = (() => { let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => { try { const r = indexedDB.open('cst-mockups', 1); r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('meta', { keyPath: 'id' }); db.createObjectStore('data', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }).catch(e => { dbp = null; throw e; }));
    const tx = async (stores, mode, f) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(stores, mode); let out; const q = f(...stores.map(n => t.objectStore(n))); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); }); };
    return { ok: typeof indexedDB !== 'undefined',
      list: () => tx(['meta'], 'readonly', m => m.getAll()), get: (id) => tx(['data'], 'readonly', d => d.get(id)),
      put: (meta, data) => tx(['meta', 'data'], 'readwrite', (m, d) => { if (meta) m.put(meta); d.put({ id: data.id, d: data.d }); }),
      rename: (id, name) => tx(['meta'], 'readwrite', m => { const q = m.get(id); q.onsuccess = () => { if (q.result) m.put(Object.assign(q.result, { name })); }; }),
      del: (id) => tx(['meta', 'data'], 'readwrite', (m, d) => { m.delete(id); d.delete(id); }) }; })();
  const mkStoreState = { cur: null, last: null, auto: false, busy: false };
  const fmtMB = (b) => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
  function mkThumb() { try { const B = MK.bg, sc = Math.min(40, 160 / Math.max(B.w, B.h)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(B.w * sc)); c.height = Math.max(1, Math.round(B.h * sc)); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); mkDraw(g, { sc, pad: 0, mode: 'off', ui: false }); return c.toDataURL('image/jpeg', 0.7); } catch (e) { return null; } }
  const isQuota = (e) => e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
  async function mkStorageInfo() { const el = $('#mkStore'); if (!el) return null; let est = null; try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { est = null; }
    if (!est || !est.quota) { el.textContent = IDB.ok ? '' : 'This browser has no IndexedDB: use Save mockup (file).'; el.classList.remove('warn'); return null; }
    const free = est.quota - (est.usage || 0), low = free < 100e6 || (est.usage || 0) / est.quota > 0.85;
    el.textContent = low ? `⚠ Browser storage is almost full (${fmtMB(est.usage || 0)} used, ${fmtMB(Math.max(0, free))} free). Delete old saves or use 💾 Save mockup (file).` : `Browser storage: ${fmtMB(est.usage || 0)} used of ${fmtMB(est.quota)}.`;
    el.classList.toggle('warn', low); return { usage: est.usage || 0, quota: est.quota, low }; }
  async function mkSaveList() { const L = $('#mkSaves'); if (!L) return []; let list = []; try { list = (await IDB.list()).filter(r => r.id !== '__auto').sort((a, b) => b.t - a.t); } catch (e) { L.innerHTML = '<div class="empty">Browser saves aren\'t available here (use the file buttons).</div>'; return []; }
    L.innerHTML = list.length ? '' : '<div class="empty">No saves in this browser yet.</div>';
    for (const r of list) { const row = document.createElement('div'); row.className = 'srow' + (mkStoreState.cur === r.id ? ' cur' : ''); row.dataset.id = r.id;
      row.innerHTML = `${r.thumb ? `<img src="${r.thumb}" alt="">` : '<span class="limg"></span>'}<span class="lname"><b>${esc(r.name)}</b><br><span class="muted">${new Date(r.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${plural(r.images || 0, 'image')} · ${fmtMB(r.bytes || 0)}</span></span><button class="mini" data-a="open">Open</button><button class="mini" data-a="ren" title="Rename">✎</button><button class="x" data-a="del" title="Delete this save">✕</button>`;
      row.querySelector('[data-a=open]').onclick = () => mkOpenSave(r.id);
      row.querySelector('[data-a=ren]').onclick = async () => { const n = prompt('Rename the save:', r.name); if (n && n.trim()) { await IDB.rename(r.id, n.trim()); if (mkStoreState.last && mkStoreState.last.id === r.id) mkStoreState.last.name = n.trim(); mkSaveList(); } };
      row.querySelector('[data-a=del]').onclick = async () => { if (!confirm(`Delete the browser save “${r.name}”?`)) return; await IDB.del(r.id); if (mkStoreState.cur === r.id) mkStoreState.cur = null; mkSaveList(); mkStorageInfo(); };
      L.append(row); }
    return list; }
  /** save in this browser under a name (same name = overwrite that save) */
  async function mkSaveIdb(name) { name = (name || '').trim() || `Mockup ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    const list = (await IDB.list().catch(() => [])).filter(r => r.id !== '__auto'), same = list.find(r => r.name === name), id = same ? same.id : 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const d = projectData('mockup'), bytes = JSON.stringify(d).length, meta = { id, name, t: Date.now(), images: items.length, layers: MK.nodes.length, bytes, thumb: mkThumb() };
    try { await IDB.put(meta, { id, d }); } catch (e) { toast(isQuota(e) ? 'Browser storage is full: not saved. Delete old saves or use Save mockup (file).' : 'Could not save in the browser: ' + (e.message || e), true); mkStorageInfo(); return null; }
    mkStoreState.cur = id; mkStoreState.last = { id, name, t: meta.t }; $('#mkSaveName').value = name; toast(`Saved “${name}” in this browser (${fmtMB(bytes)})`); await mkSaveList(); mkPanelSums(); const st = await mkStorageInfo(); if (st && st.low) toast('Saved, but browser storage is almost full', true); return id; }
  function mkQuickSave() { const nm = $('#mkSaveName').value.trim() || (mkStoreState.last && mkStoreState.last.name) || ''; return mkSaveIdb(nm); }
  async function mkOpenSave(id) { const r = await IDB.get(id); if (!r || !r.d) { toast('That save is missing', true); return false; }
    await applyProject(r.d, { settings: false, cal: false }); mkStoreState.cur = id; const m = (await IDB.list()).find(x => x.id === id); if (m) { mkStoreState.last = { id, name: m.name, t: m.t }; $('#mkSaveName').value = m.name; }
    mkAfterOpen(); toast(`Opened “${m ? m.name : 'save'}”`); mkSaveList(); return true; }
  function mkAfterOpen() { const tb = $('.tabs button[data-tab=tabMock]'); if (tb && $('#tabMock').style.display === 'none') tb.click(); else renderMock(true); mkPanelSums(); }
  function mkSaveFile() { noteFileSave(); const d = projectData('mockup'); saveBlob(`${mkBase()}-mockup-save.json`, JSON.stringify(d), 'application/json'); }
  async function mkOpenFile(file) { const d = JSON.parse(await readAsText(file)); await applyProject(d, { settings: false, cal: false }); mkStoreState.cur = null; mkAfterOpen(); toast(`Opened ${file.name}: ${plural(items.length, 'image')}, ${plural(MK.nodes.length, 'layer')}`); }
  // autosave incl. images: IndexedDB record '__auto' + a stamp in localStorage; a refresh restores it only when both match (clearing site data starts fresh)
  let mkIdbT = null, mkIdbReady = false;
  function mkIdbSoon() { if (!mkIdbReady || !IDB.ok) return; clearTimeout(mkIdbT); mkIdbT = setTimeout(mkIdbAuto, 1500); }
  async function mkIdbAuto() { if (!items.length && !MK.nodes.length) { try { STORE.del('cst.mkAuto'); await IDB.del('__auto'); } catch (e) { /* ignore */ } mkStoreState.auto = false; return; }
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d = Object.assign(projectData('autosave'), { stamp });
    try { await IDB.put(null, { id: '__auto', d }); STORE.set('cst.mkAuto', stamp); mkStoreState.auto = true; mkPanelSums(); if (window.CST && window.CST.pwa) window.CST.pwa.persist(); }
    catch (e) { if (isQuota(e)) { const el = $('#mkStore'); if (el) { el.textContent = '⚠ Browser storage is full: the autosave (with images) failed. Use 💾 Save mockup (file).'; el.classList.add('warn'); } } } }
  async function mkIdbRestore() { const stamp = STORE.get('cst.mkAuto'); try { if (stamp && !items.length && IDB.ok) { const r = await IDB.get('__auto'); if (r && r.d && r.d.stamp === stamp && (r.d.items || []).length) { await applyProject(r.d, { settings: false, cal: false }); toast(`Restored your last session: ${plural(items.length, 'image')}, ${plural(MK.nodes.length, 'layer')}`); if ($('#tabMock').style.display !== 'none') renderMock(true); mkStoreState.auto = true; } } } catch (e) { /* no autosave */ }
    mkIdbReady = true; mkStoreState.restored = true; }
  function bindMkStore() {
    $('#mkSaveFile').onclick = mkSaveFile; $('#mkOpenFile').onclick = () => $('#mkOpenInput').click();
    $('#mkOpenInput').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await mkOpenFile(f); } catch (er) { alert(er.message); } };
    $('#mkSaveIdb').onclick = () => mkSaveIdb($('#mkSaveName').value);
    mkSaveList(); mkStorageInfo(); setTimeout(mkIdbRestore, 0); }

  /** image-card badges on the Layout tab = the image's assembly steps (they change with the mockup) */
  function mkCardNums() { const st = mkSteps(); for (const el of document.querySelectorAll('.inum[data-iid]')) { const it = items.find(i => String(i.id) === el.dataset.iid); if (!it) continue; const b = stepBadge(it, st); el.textContent = b.t; el.title = b.tip; } }
  // test / automation hooks (local only)
  window.CST = { saveToolCopy, get EMBEDDED() { return EMBEDDED; }, STORE, exportCal, importCalData, calStatusLine, getCal, saveCal, onCompute, choose, renderCalTable, currentState, stateCode, get lastResult() { return lastResult; }, S, get items() { return items; }, setPct, pctOf, BASE_DPI, addFromDataURL, computeLayout, buildPDF, buildSVGs, buildCalPDF, buildCalSVG, computeCalibration, getCorr, setCorr, drawPreview, refresh, sheetDims, calTargets, get layout() { return layout; }, cache,
    get manual() { return manual; }, set manual(v) { manual = v; }, pinLayout, resetAuto, selectPiece, selectItem, get sel() { return sel; }, get curSheet() { return curSheet; }, set curSheet(v) { curSheet = v; },
    get MK() { return MK; }, mkSetSize, mkGeom: (n) => { const G = ng(n); return G && { w: G.w, h: G.h }; }, renderMock, mkSelect, get mkSel() { return mkSel; }, get mkView() { return mkView; }, mkOrder, mockPNG, guidePNG, guidePDF, pieceLabels, mkSteps, legendRows, cutStepLabels, stepBadge, insidePiece, numOf, mkUndo: () => mkUndoFn(), mkRedo: () => mkRedoFn(), mkFitBackdrop, mkSendPlan, mkSendApply, mkSendOpen, mkBgRect, mkBgToBackdrop, imgDpi, set mkBgAdj(v) { mkBgAdj = !!v; renderMkBg(); renderMockCanvas(); }, get mkBgAdj() { return mkBgAdj; },
    projectData, applyProject, processed, processedBase, syncItemWarps, mkSaveIdb, mkQuickSave, warpMap, warpQuad, nodePath, mkWarpHandles, mkSetXf, get mkXf() { return mkXf; }, isWarped, mkOpenSave, mkSaveFile, mkOpenFile, mkSaveList, mkStorageInfo, mkIdbAuto, IDB, setMkCol, mkPanelSum, get mkStoreState() { return mkStoreState; },
    mkAdd, mkCommit, download, saveBlob, toast, mkLiveSize, mkLiveRot, mkCancelDrag, applyChrome, mkPtFromClient, sheetPt, layoutHitSelected, cancelLayoutDrag, nodeItem, mkZoom, mkDelete, mkSetRot, mkSig, storageNudge, budgetDpi, get mkUndoDepth() { return mkUndo.length; },
    rotatePiece, moveToSheet, duplicatePiece, deletePiece, nudge, fillQty, undo, redo, get undoDepth() { return undoStack.length; }, get view() { return view; }, setZoom, saveProject, loadProject, findSpot };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
