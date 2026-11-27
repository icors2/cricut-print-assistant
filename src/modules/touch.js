/* Pinch / twist / long-press on top of Pointer Events. One gesture = one undo step. */
(function () {
  'use strict';
  const C = window.CST;
  /** h: { hitSelected(pt) → bool, begin(), scale(k), rotate(deg), zoom(k, c), pan(dx, dy), longPress(pt), end() } */
  function attach(canvas, h) {
    if (!canvas || canvas.dataset.touch) return;
    canvas.dataset.touch = '1';
    const pts = new Map(); let g = null, lp = null, scroll0 = 0;
    const P = (e) => ({ x: e.clientX, y: e.clientY }), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const snap = (d) => { const s = Math.round(d / 15) * 15; return Math.abs(d - s) <= 3 ? s : d; };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      pts.set(e.pointerId, P(e));
      if (pts.size === 1) { scroll0 = window.scrollY; const p0 = P(e); lp = setTimeout(() => { lp = null; h.longPress(p0); }, 500); }
      if (pts.size === 2) {
        clearTimeout(lp); lp = null; const [a, b] = [...pts.values()];
        g = { d0: Math.max(1, dist(a, b)), a0: ang(a, b), c0: mid(a, b), onSel: !!h.hitSelected(mid(a, b)), placed: false }; h.begin();
        e.preventDefault(); e.stopImmediatePropagation();
      }
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const old = pts.get(e.pointerId), now = P(e); pts.set(e.pointerId, now);
      if (lp && dist(old, now) > 8) { clearTimeout(lp); lp = null; }
      if (g && pts.size === 2) {
        if (!g.placed) { window.scrollTo(window.scrollX, scroll0); const [a0, b0] = [...pts.values()], m0 = mid(a0, b0); g.onSel = !!h.hitSelected(m0); g.c0 = m0; g.placed = true; }
        const [a, b] = [...pts.values()], k = dist(a, b) / g.d0, da = ang(a, b) - g.a0, c = mid(a, b);
        if (g.onSel) { h.scale(k); h.rotate(snap(da)); } else { h.zoom(k, c); h.pan(c.x - g.c0.x, c.y - g.c0.y); }
        e.preventDefault(); e.stopImmediatePropagation();
      }
    }, { capture: true });
    const up = (e) => { if (!pts.delete(e.pointerId)) return; clearTimeout(lp); lp = null; if (g && pts.size < 2) { g = null; h.end(); } };
    canvas.addEventListener('pointerup', up, { capture: true });
    canvas.addEventListener('pointercancel', up, { capture: true });
  }

  function pieceUnder(client) {
    const p = C.mkPtFromClient(client.x, client.y), n = C.MK.nodes.slice().reverse().find(node => {
      if (node.hidden) return false;
      const g = C.mkGeom(node); if (!g) return false;
      const dx = p.x - node.x, dy = p.y - node.y, a = -node.rot * Math.PI / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(lx) <= g.w / 2 + 0.02 && Math.abs(ly) <= g.h / 2 + 0.02;
    });
    return n || null;
  }

  let ctxAt = 0;
  function showCtx(client) {
    ctxAt = Date.now();
    const bar = document.getElementById('touchCtx'); if (!bar) return;
    const acts = [['dup', 'Duplicate'], ['del', 'Delete'], ['front', 'To front'], ['back', 'To back'], ['flip', 'Flip'], ['color', '🎨 Colors']];
    bar.innerHTML = '';
    for (const [id, label] of acts) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.act = id;
      b.addEventListener('click', () => doCtx(id)); bar.appendChild(b);
    }
    bar.hidden = false;
    bar.style.left = Math.max(8, Math.min(window.innerWidth - 300, client.x - 20)) + 'px';
    bar.style.top = Math.max(8, client.y - 64) + 'px';
  }
  function doCtx(id) {
    const bar = document.getElementById('touchCtx'); if (bar) bar.hidden = true;
    const n = C.mkSel, it = n && C.nodeItem(n); if (!n) return;
    if (id === 'dup' && it) { C.mkSelect(C.mkAdd(it, n)); C.mkCommit(); C.renderMock(true); }
    else if (id === 'del') C.mkDelete(n);
    else if (id === 'front') C.mkOrder(n, 'front');
    else if (id === 'back') C.mkOrder(n, 'back');
    else if (id === 'flip') { if (n.locked) return; n.flip = !n.flip; C.mkCommit(); C.renderMock(true); }
    else if (id === 'color') C.bus.emit('color:open', { node: n, item: it });
  }

  function mockHost() {
    let base = null, dirty = false;
    return {
      hitSelected: (pt) => { const n = pieceUnder(pt); return !!(n && C.mkSel && n.uid === C.mkSel.uid); },
      begin: () => {
        const n = C.mkSel, it = n && C.nodeItem(n), box = document.querySelector('#mkCanvas').parentElement;
        base = { it, n, w: it ? it.wIn : 1, h: it ? it.hIn : 1, rot: n ? n.rot : 0, zoom: C.MK.zoom || 1, sl: box.scrollLeft, st: box.scrollTop, box };
        dirty = false; C.mkCancelDrag();
      },
      scale: (k) => { if (!base || !base.it || (base.n && base.n.locked)) return; C.mkLiveSize(base.it, base.w * k, base.h * k); dirty = true; },
      rotate: (d) => { if (!base || !base.n || base.n.locked) return; C.mkLiveRot(base.n, base.rot + d); if (Math.abs(d) > 0.01) dirty = true; },
      zoom: (k) => { C.mkZoom((base ? base.zoom : 1) * k); },
      pan: (dx, dy) => { if (!base) return; base.box.scrollLeft = base.sl - dx; base.box.scrollTop = base.st - dy; },
      longPress: (pt) => { const n = pieceUnder(pt); if (!n) return; C.mkSelect(n); showCtx(pt); },
      end: () => { if (dirty) { C.mkCommit(); C.refresh(true); } dirty = false; base = null; },
    };
  }
  function layoutHost() {
    let base = null, dirty = false;
    return {
      hitSelected: (pt) => C.layoutHitSelected(pt.x, pt.y),
      begin: () => {
        const e = C.sel && C.layout && C.layout.sheets.flat().find(x => x.key === C.sel.key);
        const box = document.querySelector('#preview').parentElement;
        base = { it: e && e.it, w: e && e.it.wIn, h: e && e.it.hIn, zoom: C.S.zoom || 1, sl: box.scrollLeft, st: box.scrollTop, box };
        dirty = false; C.cancelLayoutDrag();
      },
      scale: (k) => { if (!base || !base.it) return; C.mkLiveSize(base.it, base.w * k, base.h * k); dirty = true; },
      rotate: () => {},
      zoom: (k) => { C.setZoom((base ? base.zoom : 1) * k); },
      pan: (dx, dy) => { if (!base) return; base.box.scrollLeft = base.sl - dx; base.box.scrollTop = base.st - dy; },
      longPress: () => {},
      end: () => { if (dirty) { C.mkCommit(); C.refresh(true); } dirty = false; base = null; },
    };
  }

  function wireBar() {
    const onMock = () => { const t = document.querySelector('#tabMock'); return t && t.style.display !== 'none'; };
    const n = () => C.mkSel;
    const act = (fn) => () => { if (onMock()) fn(); };
    document.getElementById('tbUndo').onclick = () => (onMock() ? C.mkUndo() : C.undo());
    document.getElementById('tbRedo').onclick = () => (onMock() ? C.mkRedo() : C.redo());
    document.getElementById('tbDup').onclick = act(() => { const node = n(), it = node && C.nodeItem(node); if (it) { C.mkSelect(C.mkAdd(it, node)); C.mkCommit(); C.renderMock(true); } });
    document.getElementById('tbDel').onclick = act(() => { if (n()) C.mkDelete(n()); });
    document.getElementById('tbUp').onclick = act(() => { if (n()) C.mkOrder(n(), 'up'); });
    document.getElementById('tbDown').onclick = act(() => { if (n()) C.mkOrder(n(), 'down'); });
    document.getElementById('tbFlip').onclick = act(() => { const node = n(); if (!node || node.locked) return; node.flip = !node.flip; C.mkCommit(); C.renderMock(true); });
    document.getElementById('tbRotL').onclick = act(() => { const node = n(); if (!node || node.locked) return; C.mkSetRot(node, node.rot - 15); C.mkCommit(); C.renderMock(true); });
    document.getElementById('tbRotR').onclick = act(() => { const node = n(); if (!node || node.locked) return; C.mkSetRot(node, node.rot + 15); C.mkCommit(); C.renderMock(true); });
    document.addEventListener('pointerdown', (e) => {
      const bar = document.getElementById('touchCtx');
      if (!bar || bar.hidden || bar.contains(e.target)) return;
      if (Date.now() - ctxAt < 700) return; // the touchend compatibility click must not dismiss the bar
      bar.hidden = true;
    });
  }

  function boot() {
    C.applyChrome();
    attach(document.querySelector('#mkCanvas'), mockHost());
    attach(document.querySelector('#preview'), layoutHost());
    wireBar();
  }
  C.touch = C.registerModule('touch', { attach, boot });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
