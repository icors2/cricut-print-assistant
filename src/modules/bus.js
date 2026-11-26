/* Module plumbing: a tiny event bus and an extension registry. Loaded first (see src/modules/ORDER). */
(function () {
  'use strict';
  const C = window.CST; if (!C) throw new Error('CST missing: modules must load after app.js');
  const handlers = new Map();
  C.bus = {
    on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); return () => handlers.get(ev).delete(fn); },
    emit(ev, data) { for (const fn of handlers.get(ev) || []) { try { fn(data); } catch (e) { console.error('[bus]', ev, e); } } },
  };
  C.ext = C.ext || {};
  C.registerModule = (name, api) => {
    if (C.ext[name]) throw new Error('module ' + name + ' registered twice');
    C.ext[name] = api; C.bus.emit('module:ready', name); return api;
  };
  // app.js emits: 'items:changed' (after refresh), 'mockup:changed' (mkCommit), 'tab:shown' (tab switch)
})();
