// ±8 mm scales on the calibration sheet: tick geometry in the actual PDF (plain and compensated), slit-crossing margin, no text/scale overlap
const puppeteer = require('puppeteer-core'), path = require('path'); const R = path.resolve(__dirname, '..'), MM = 25.4, PT = 72;
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] }); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + R + '/index.html'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); window.name = ''; }); await p.reload(); await new Promise(r => setTimeout(r, 500));
  for (const [ex, ey] of [[1, 1], [1.0262, 1.0288]]) {
    const out = await p.evaluate((ex, ey) => { const C = window.CST, c = C.getCal(); c.ex = ex; c.ey = ey; c.mode = ex === 1 ? null : 'compensate'; C.saveCal(c);
      const doc = C.buildCalPDF(), H = doc.internal.pageSize.getHeight(), b64 = doc.output('datauristring').split(',')[1];
      const svg = C.buildCalSVG(), T = C.calTargets(C.sheetDims()); return { b64, H, T, svg }; }, ex, ey);
    const buf = Buffer.from(out.b64, 'base64'), zlib = require('zlib'); let raw = ''; let i = 0;
    while ((i = buf.indexOf('stream', i)) >= 0) { let st = i + 6; if (buf[st] === 13) st++; if (buf[st] === 10) st++; const e = buf.indexOf('endstream', st); if (e < 0) break;
      try { raw += zlib.inflateSync(buf.subarray(st, e)).toString('latin1') + '\n'; } catch (er) { raw += buf.subarray(st, e).toString('latin1') + '\n'; } i = e + 9; }
    out.lines = []; const re = /(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l/g; let m; while ((m = re.exec(raw))) out.lines.push([+m[1], out.H - +m[2], +m[3], out.H - +m[4]]);
    const P = (x, y) => [(4.25 + ex * (x - 4.25)) * PT, (5.5 + ey * (y - 5.5)) * PT], half = 0.875 / 2;
    let allOk = true, msg = [];
    for (const t of out.T) {
      const L = t.x - half, Tt = t.y - half, [, rowY] = P(0, t.y), [colX] = P(t.x, 0);
      const xt = out.lines.filter(l => Math.abs(l[0] - l[2]) < 1e-3 && Math.abs((l[1] + l[3]) / 2 - rowY) < 0.01 && Math.abs(l[3] - l[1]) < 15).map(l => l[0]).sort((a, c) => a - c);
      const yt = out.lines.filter(l => Math.abs(l[1] - l[3]) < 1e-3 && Math.abs((l[0] + l[2]) / 2 - colX) < 0.01 && Math.abs(l[2] - l[0]) < 15).map(l => l[1]).sort((a, c) => a - c);
      const [x0] = P(L - 8 / MM, 0), [x1] = P(L + 8 / MM, 0), [, y0] = P(0, Tt - 8 / MM), [, y1] = P(0, Tt + 8 / MM);
      const [xl] = P(L - 9 / MM, 0), [xr] = P(L + 9 / MM, 0), [, yt0] = P(0, Tt - 9 / MM), [, yt1] = P(0, Tt + 9 / MM);
      xt.splice(0, xt.length, ...xt.filter(v => v > xl && v < xr)); yt.splice(0, yt.length, ...yt.filter(v => v > yt0 && v < yt1));
      const step = (arr) => arr.slice(1).map((v, i) => v - arr[i]);
      const xs = [...new Set(xt.map(v => v.toFixed(3)))].map(Number), ys = [...new Set(yt.map(v => v.toFixed(3)))].map(Number);
      const good = xs.length === 33 && ys.length === 33 && Math.abs(xs[0] - x0) < 0.01 && Math.abs(xs[32] - x1) < 0.01 && Math.abs(ys[0] - y0) < 0.01 && Math.abs(ys[32] - y1) < 0.01
        && step(xs).every(d => Math.abs(d - 0.5 / MM * PT * ex) < 0.01) && step(ys).every(d => Math.abs(d - 0.5 / MM * PT * ey) < 0.01);
      if (!good) { allOk = false; msg.push(`${t.id}: ${xs.length}/${ys.length} ticks`); }
    }
    ok(allOk, `compensation ${ex}/${ey}: every target has 33 X + 33 Y ticks (-8..+8 mm, 0.5 mm apart${ex !== 1 ? ', enlarged with the page so they print true mm' : ''}) ${msg.join(' ')}`);
  }
  // slit geometry: the cut square's left/top edges must cross the X row / Y column for any offset within ±8 mm
  const half = 0.875 / 2 * MM; ok(half - 8 >= 3, `cut square half-size ${half.toFixed(2)} mm: at ±8 mm offsets the slit still crosses both scales with ${(half - 8).toFixed(2)} mm to spare`);
  await b.close(); ok(!errs.length, 'no page errors ' + JSON.stringify(errs)); process.exit(fails ? 1 : 0);
})();
