// Simulation: synthetic printer/cutter error -> readings -> fit -> corrected cut must land within 0.1 mm
require('../src/core.js'); const C = globalThis.CSTCore, MM = 25.4;
const sh = { w: 8.5, h: 11 }, cx = sh.w / 2, cy = sh.h / 2, a = 0.25 + 0.75;
const T = [['T1', a, a], ['T2', sh.w - a, a], ['T3', cx, cy], ['T4', a, sh.h - a], ['T5', sh.w - a, sh.h - a]];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// "true" machine: file position f -> physical cut position (relative to paper/print)
function machine(sx, sy, thDeg, ux, uy, shear) { const th = thDeg * Math.PI / 180;
  return (fx, fy) => { const dx = fx - cx, dy = fy - cy; return [cx + sx * (Math.cos(th) * dx - Math.sin(th) * dy) + (shear || 0) * dy + ux, cy + sy * (Math.sin(th) * dx + Math.cos(th) * dy) + uy]; }; }
function calibrate(M, corr, noiseMm, seed) { let r = seed || 1; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const f = C.makeCorrector(corr, cx, cy);
  const samples = T.map(([id, px, py]) => { const [fx, fy] = f(px, py), [kx, ky] = M(fx, fy); return { id, px, py, fx, fy, rx: kx - px + rnd() * noiseMm / MM, ry: ky - py + rnd() * noiseMm / MM }; });
  return { samples, m: C.fitMachine(samples, cx, cy) }; }
function worstAfter(M, corr) { const f = C.makeCorrector(corr, cx, cy); let w = 0;
  for (let x = 0.3; x <= sh.w - 0.3; x += 0.79) for (let y = 0.3; y <= sh.h - 0.3; y += 0.83) { const [fx, fy] = f(x, y), [kx, ky] = M(fx, fy); w = Math.max(w, Math.hypot(kx - x, ky - y) * MM); } return w; }
// 1) typical error: cut 2.8% / 2.9% larger, 0.15 deg rotation, offset
const M1 = machine(1.028, 1.029, 0.15, -1.4 / MM, -2.5 / MM);
const c1 = calibrate(M1, C.IDENTITY, 0); ok(Math.abs(c1.m.sx - 1.028) < 1e-4 && Math.abs(c1.m.sy - 1.029) < 1e-4, `recovers scale sx=${c1.m.sx.toFixed(5)} sy=${c1.m.sy.toFixed(5)}`);
ok(Math.abs(c1.m.th * 180 / Math.PI - 0.15) < 0.01, `recovers rotation ${(c1.m.th * 180 / Math.PI).toFixed(4)} deg`);
ok(Math.abs(c1.m.ux * MM + 1.4) < 0.01 && Math.abs(c1.m.uy * MM + 2.5) < 0.01, `recovers centre offset ${(c1.m.ux * MM).toFixed(3)}, ${(c1.m.uy * MM).toFixed(3)} mm`);
const k1 = C.correctionFromMachine(c1.m), w1 = worstAfter(M1, k1); ok(w1 < 0.1, `corrected cut error over whole sheet: worst ${w1.toFixed(4)} mm (uncorrected ${worstAfter(M1, C.IDENTITY).toFixed(2)} mm)`);
// 2) second pass with the correction applied -> readings ~0 and refit identical
const c2 = calibrate(M1, k1, 0); const maxR = Math.max(...c2.samples.map(q => Math.max(Math.abs(q.rx), Math.abs(q.ry)))) * MM;
ok(maxR < 0.1, `re-calibration with correction applied: max reading ${maxR.toFixed(4)} mm`);
const k2 = C.correctionFromMachine(c2.m); ok(worstAfter(M1, k2) < 0.1, `refit from corrected run still lands: ${worstAfter(M1, k2).toFixed(4)} mm`);
// 3) noisy readings (0.5 mm) -> still good to ~0.5 mm
const c3 = calibrate(M1, C.IDENTITY, 0.5, 7), w3 = worstAfter(M1, C.correctionFromMachine(c3.m)); ok(w3 < 0.7, `with ±0.5 mm reading noise: worst ${w3.toFixed(3)} mm`);
// 4) legacy v1 correction behaves as before
const f1 = C.makeCorrector({ ax: 0.04, ay: 0.03, bx: 0.003, by: 0 }, cx, cy)(1, 1); ok(Math.abs(f1[0] - (1 - (0.04 + 0.003 * (1 - cx)))) < 1e-12 && Math.abs(f1[1] - (1 - 0.03)) < 1e-12, 'legacy {ax,ay,bx,by} correction unchanged');
// 5) describeCorr round-trip
const d = C.describeCorr(k1); ok(Math.abs(d.sx - c1.m.sx) < 1e-9 && Math.abs(d.th - c1.m.th) < 1e-9 && Math.abs(d.ux - c1.m.ux) < 1e-9, 'describeCorr inverts correctionFromMachine');
// 6) partial readings fall back gracefully
const part = c1.samples.map((q, i) => i === 2 ? q : Object.assign({}, q, { rx: NaN, ry: NaN })); const mp = C.fitMachine(part, cx, cy); ok(!mp.useTh && !mp.useSx && Math.abs(mp.ux - (part[2].px + part[2].rx - cx)) < 1e-9, 'single target -> offset only');
// 7) synthetic sample readings (made-up printer: 2.55% / 2.8% shrink, 0.4° paper rotation)
const R2 = { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
const sm = T.map(([id, px, py]) => ({ id, px, py, fx: px, fy: py, rx: R2[id][0] / MM, ry: R2[id][1] / MM })), m = C.fitMachine(sm, cx, cy);
console.log('SAMPLE PASS A:', JSON.stringify({ sxPct: ((m.sx - 1) * 100).toFixed(2), syPct: ((m.sy - 1) * 100).toFixed(2), rotDeg: (m.th * 180 / Math.PI).toFixed(3), uxMm: (m.ux * MM).toFixed(2), uyMm: (m.uy * MM).toFixed(2),
  resid: m.residuals.map(r => `${r.id}: ${(r.x * MM).toFixed(2)}, ${(r.y * MM).toFixed(2)}`) }));
const R1 = { T1: [-3.5, -6.25], T2: [0.75, -5.5], T3: [-2, -2.5], T4: [-4.5, 0.25], T5: [-0.25, 1] };
const m1 = C.fitMachine(T.map(([id, px, py]) => ({ id, px, py, fx: px, fy: py, rx: R1[id][0] / MM, ry: R1[id][1] / MM })), cx, cy);
console.log('SAMPLE PASS B:', JSON.stringify({ sxPct: ((m1.sx - 1) * 100).toFixed(2), syPct: ((m1.sy - 1) * 100).toFixed(2), rotDeg: (m1.th * 180 / Math.PI).toFixed(3), uxMm: (m1.ux * MM).toFixed(2), uyMm: (m1.uy * MM).toFixed(2), resid: m1.residuals.map(r => `${r.id}: ${(r.x * MM).toFixed(2)}, ${(r.y * MM).toFixed(2)}`) }));
// scale-only model for comparison
const ms = C.fitMachine(sm.map(q => q), cx, cy);
// 8) a mis-read target shows up as a large residual (> 1 mm) at that target
const bad = sm.map(q => q.id === 'T4' ? Object.assign({}, q, { rx: q.rx + 3 / MM }) : q), mb = C.fitMachine(bad, cx, cy);
const big = mb.residuals.filter(r => Math.abs(r.x * MM) > 1 || Math.abs(r.y * MM) > 1).map(r => r.id); ok(big.includes('T4'), `3 mm mis-read at T4 flagged (residual > 1 mm at: ${big.join(', ')})`);
process.exit(fails ? 1 : 0);
