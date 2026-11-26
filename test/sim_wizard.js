// End-to-end physical simulation of the guided calibration (made-up numbers): printer shrink + paper rotation + offsets + reading noise
require('../src/core.js'); const C = globalThis.CSTCore, MM = 25.4;
const W = 8.5, H = 11, cx = W / 2, cy = H / 2, a = 1.0, inset = 0.25;
const TG = [['T1', a, a], ['T2', W - a, a], ['T3', cx, cy], ['T4', a, H - a], ['T5', W - a, H - a]];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const deg = Math.PI / 180;
function world(o) { // physical model: printer Pr(file y) -> paper; cutter K(file f) -> paper (cutter itself accurate; paper sits rotated/shifted on the mat)
  const sx = 1 - o.shrinkX, sy = 1 - o.shrinkY, th = o.rotDeg * deg, ox = o.printerCenter ? o.printerCenter[0] : cx, oy = o.printerCenter ? o.printerCenter[1] : cy;
  const Pr = (x, y) => [ox + sx * (x - ox) + o.printOff[0] / MM, oy + sy * (y - oy) + o.printOff[1] / MM];
  const K = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + Math.cos(th) * dx - Math.sin(th) * dy + o.matOff[0] / MM, cy + Math.sin(th) * dx + Math.cos(th) * dy + o.matOff[1] / MM]; };
  return { Pr, K };
}
function rng(seed) { let r = seed; return () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 2; }
function runPass(wd, cal, noiseMm, seed, tweak) { // what a user would read off a calibration sheet made from `cal`
  const rnd = rng(seed), pc = C.printMap(cal.ex, cal.ey, cx, cy), cut = C.makeCorrector(C.calCutCorr(cal), cx, cy);
  return TG.map(([id, px, py]) => { const [yx, yy] = pc(px, py), [fx, fy] = cut(px, py), ink = wd.Pr(yx, yy), k = wd.K(fx, fy);
    const q = { id, px, py, yx, yy, fx, fy, rx: k[0] - ink[0] + rnd() * noiseMm / MM, ry: k[1] - ink[1] + rnd() * noiseMm / MM };
    // readings are read to the nearest 0.25 mm like a person would
    q.rx = Math.round(q.rx * MM * 4) / 4 / MM; q.ry = Math.round(q.ry * MM * 4) / 4 / MM; return tweak ? tweak(q) : q; });
}
function compute(cal, samples) { const fit = C.calFit(samples, cx, cy), pat = C.readingPattern(samples, cx, cy);
  const v = C.judgePass({ samples, fit, pat, ex: cal.ex, ey: cal.ey, mode: cal.mode, tol: 0.5 / MM, spanX: W - 2 * a, spanY: H - 2 * a }); return { fit, pat, v }; }
function trueError(wd, cal) { // worst physical cut-vs-ink error and worst ink-vs-design (true size) error over the usable sheet
  const pc = C.printMap(cal.ex, cal.ey, cx, cy), cut = C.makeCorrector(C.calCutCorr(cal), cx, cy); let wc = 0;
  for (let x = 0.3; x <= W - 0.3 + 1e-9; x += 0.395) for (let y = 0.3; y <= H - 0.3 + 1e-9; y += 0.52) { const ink = wd.Pr(...pc(x, y)), k = wd.K(...cut(x, y)); wc = Math.max(wc, Math.hypot(k[0] - ink[0], k[1] - ink[1]) * MM); }
  const tl = wd.Pr(...pc(inset, inset)), tr = wd.Pr(...pc(W - inset, inset)), bl = wd.Pr(...pc(inset, H - inset));
  return { cutVsInkMm: wc, markX: Math.hypot(tr[0] - tl[0], tr[1] - tl[1]), markY: Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) };
}
const PRINTER = world({ shrinkX: 0.0255, shrinkY: 0.028, rotDeg: 0.4, printOff: [0.3, -0.4], matOff: [-1.0, -1.8] });
const pct = (v) => (v * 100).toFixed(2) + '%';
// ---- pass 1 (uncorrected files, like a first real pass) ----
let cal = C.calDefault(); const t0 = trueError(PRINTER, cal);
console.log(`printer marks before: ${t0.markX.toFixed(3)} x ${t0.markY.toFixed(3)} in (should be 8.000 x 10.500), cut vs ink up to ${t0.cutVsInkMm.toFixed(2)} mm`);
const p1 = compute(cal, runPass(PRINTER, cal, 0.3, 11));
console.log(`pass 1 verdict: ${p1.v.status}; shrink X ${pct(p1.v.shrinkX)} Y ${pct(p1.v.shrinkY)}; compensation +${pct(p1.v.compX)} / +${pct(p1.v.compY)}; worst reading ${(p1.v.worst * MM).toFixed(2)} mm`);
ok(p1.v.status === 'needs-choice', 'pass 1 detects the printer shrink and asks for a choice');
ok(Math.abs(p1.v.shrinkX - 0.0255) < 0.0015 && Math.abs(p1.v.shrinkY - 0.028) < 0.0015, 'fitted shrink within 0.15% of the true 2.55% / 2.80%');
// ---- Path A: compensate ----
let A = Object.assign(C.calDefault(), { Q: p1.fit.Q, ex: 1 + p1.v.compX, ey: 1 + p1.v.compY, mode: 'compensate', pass: 1 });
const ta = trueError(PRINTER, A); console.log(`A: compensation +${pct(A.ex - 1)} / +${pct(A.ey - 1)} -> printed marks ${ta.markX.toFixed(4)} x ${ta.markY.toFixed(4)} in; cut vs ink up to ${ta.cutVsInkMm.toFixed(2)} mm`);
ok(Math.abs(ta.markX - 8) < 0.012 && Math.abs(ta.markY - 10.5) < 0.016, 'Path A: printed corner marks come out true size (8.000 x 10.500 in within 0.3 mm)');
const cutCorrA = C.describeCorr(C.calCutCorr(A)); ok(Math.abs(cutCorrA.sx - 1) < 0.0015 && Math.abs(cutCorrA.sy - 1) < 0.0015, `Path A: cut correction has ~no scale (${pct(cutCorrA.sx - 1)} / ${pct(cutCorrA.sy - 1)}), only rotation ${(cutCorrA.th / deg).toFixed(2)}° + offset`);
const p2a = compute(A, runPass(PRINTER, A, 0.3, 23));
console.log(`A pass 2: ${p2a.v.status}, worst reading ${(p2a.v.worst * MM).toFixed(2)} mm, adjustComp=${!!p2a.v.adjustComp}`);
ok(p2a.v.status === 'calibrated', 'Path A pass 2 readings near 0 -> "Calibrated"');
// refine (not stack): saving pass-2 fit keeps the same physics
const A2 = Object.assign({}, A, { Q: p2a.fit.Q }); ok(trueError(PRINTER, A2).cutVsInkMm < 0.5, `refined after pass 2: cut vs ink ${trueError(PRINTER, A2).cutVsInkMm.toFixed(2)} mm (absolute refit, no stacking)`);
// noise-free check of the exactness of the model
const Anf = compute(cal, runPass(PRINTER, cal, 0, 1)); const An = Object.assign(C.calDefault(), { Q: Anf.fit.Q, ex: 1 + Anf.v.compX, ey: 1 + Anf.v.compY, mode: 'compensate' });
const An2 = Object.assign({}, An, { Q: C.calFit(runPass(PRINTER, An, 0, 1).map(q => (q.rx = q.rx, q)), cx, cy).Q });
ok(trueError(PRINTER, An).cutVsInkMm < 0.3 && trueError(PRINTER, An2).cutVsInkMm < 0.15, `noise-free: after pass 1 ${trueError(PRINTER, An).cutVsInkMm.toFixed(3)} mm (0.25 mm reading rounding), refit ${trueError(PRINTER, An2).cutVsInkMm.toFixed(3)} mm`);
// ---- Path B: keep ----
const B = Object.assign(C.calDefault(), { Q: p1.fit.Q, ex: 1, ey: 1, mode: 'keep', pass: 1 }), tb = trueError(PRINTER, B);
const p2b = compute(B, runPass(PRINTER, B, 0.3, 31));
console.log(`B: no compensation, printed marks ${tb.markX.toFixed(3)} in; cut vs ink up to ${tb.cutVsInkMm.toFixed(2)} mm; pass 2 ${p2b.v.status}, worst ${(p2b.v.worst * MM).toFixed(2)} mm`);
ok(p2b.v.status === 'calibrated' && Math.abs(B.ex - 1) < 1e-12, 'Path B pass 2 -> "Calibrated" with no compensation');
// ---- error cases ----
const pBad = compute(A, runPass(PRINTER, A, 0.3, 23, q => q.id === 'T4' ? Object.assign(q, { rx: q.rx + 2.5 / MM }) : q));
ok(pBad.v.status === 'bad-reading' && pBad.v.bad.includes('T4'), `one mis-read (T4 +2.5 mm) -> ${pBad.v.status} at ${pBad.v.bad.join(',')}`);
const moved = world({ shrinkX: 0.0255, shrinkY: 0.028, rotDeg: 0.4, printOff: [0.3, -0.4], matOff: [0.6, -1.8] }); // paper placed 1.6 mm further right
const pMov = compute(A, runPass(moved, A, 0.3, 23)); ok(pMov.v.status === 'retry' && pMov.v.kinds.includes('offset'), `paper placed 1.6 mm off -> ${pMov.v.status} (${pMov.v.kinds.join(',')}, offset ${pMov.v.components.offMm.toFixed(2)} mm)`);
const Awrong = Object.assign({}, A, { ex: 1.012, ey: 1.012 }); const pW = compute(Awrong, runPass(PRINTER, Awrong, 0.3, 5));
ok(pW.v.adjustComp && Math.abs(pW.v.compX - 0.0262) < 0.002, `compensation set too low (1.2%) -> suggests adjusting to +${pct(pW.v.compX)} / +${pct(pW.v.compY)}`);
const rs = C.rulerShrink(7.8, 8.0, 1); ok(Math.abs(rs.shrink - 0.025) < 1e-9 && Math.abs(rs.comp - 0.02564) < 1e-4, `ruler 7.80 in of 8.000 -> shrink ${pct(rs.shrink)}, compensation +${(rs.comp * 100).toFixed(3)}%`);
const offCentre = world({ shrinkX: 0.0255, shrinkY: 0.028, rotDeg: 0.4, printOff: [0, 0], matOff: [-1, -1.8], printerCenter: [0.2, 0.2] }); // printer shrinks toward the top-left instead
const po = compute(C.calDefault(), runPass(offCentre, C.calDefault(), 0, 3)); const Ao = Object.assign(C.calDefault(), { Q: po.fit.Q, ex: 1 + po.v.compX, ey: 1 + po.v.compY, mode: 'compensate' });
ok(trueError(offCentre, Ao).cutVsInkMm < 0.35 && Math.abs(trueError(offCentre, Ao).markX - 8) < 0.012, `printer shrinking toward a corner instead of the centre: still true size (${trueError(offCentre, Ao).markX.toFixed(4)} in) and cut vs ink ${trueError(offCentre, Ao).cutVsInkMm.toFixed(2)} mm (offset absorbed)`);
// synthetic sample readings through the model
const R2 = { T1: [-2.25, -5.5], T2: [2, -4.5], T3: [-1, -1.75], T4: [-3.75, 0.75], T5: [0.25, 2] };
const sC = TG.map(([id, px, py]) => ({ id, px, py, yx: px, yy: py, fx: px, fy: py, rx: R2[id][0] / MM, ry: R2[id][1] / MM })), rC = compute(C.calDefault(), sC);
console.log('SAMPLE READINGS ->', JSON.stringify({ status: rC.v.status, shrinkX: pct(rC.v.shrinkX), shrinkY: pct(rC.v.shrinkY), compX: '+' + pct(rC.v.compX), compY: '+' + pct(rC.v.compY), rotDeg: (rC.fit.q.th / deg).toFixed(2), offsetMm: [(rC.fit.q.ux * MM).toFixed(2), (rC.fit.q.uy * MM).toFixed(2)], misfit: rC.fit.misfit.map(m => `${m.id} ${(m.x * MM).toFixed(2)}/${(m.y * MM).toFixed(2)}`) }));
process.exit(fails ? 1 : 0);
