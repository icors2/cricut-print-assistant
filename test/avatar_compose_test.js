// P4·M1: pairs, swap, hides, then z-order. Colours go through recolor.
const puppeteer = require('puppeteer-core'), path = require('path'), { spawn } = require('child_process');
const R = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const chrome = process.env.CHROME || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(R, 'tools', 'serve.js')], { cwd: R });
    let buf = '';
    child.stdout.on('data', d => { buf += d; if (buf.includes('\n')) resolve({ child, port: +buf.trim() }); });
    child.on('exit', code => reject(new Error('serve exited ' + code)));
  });
}
(async () => {
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + srv.port + '/');
  await p.waitForFunction(() => window.CST && window.CST.assets && window.CST.assets.avatarParts(), { timeout: 8000 });
  const r = await p.evaluate(async () => {
    const C = window.CST, base = { schema: 'cpa-avatar-spec/1', template: 'kid-v1', parts: { body: 'core.avatar.body-01', face: 'core.avatar.face-round', eyes: 'core.avatar.eyes-happy', mouth: 'core.avatar.mouth-smile', hairFront: 'core.avatar.hair-bob-front' }, colors: { skin: '#e0ac69', hair: '#2b1b10', eyes: '#3b6ea5' } };
    const layers = C.avatar.resolve(base).map(x => x.part.id);
    const hat = C.avatar.resolve(Object.assign({}, base, { parts: Object.assign({}, base.parts, { hat: 'core.avatar.hat-beanie' }) })).map(x => x.part.id);
    const svg = await C.avatar.compose(base);
    const rand = C.avatar.randomize(7, { hairFront: true }, base);
    return { layers, hat, prefixed: svg.includes('core_avatar_body_01__') && svg.includes('fill="#e0ac69"'), locked: rand.parts.hairFront === 'core.avatar.hair-bob-front', same: JSON.stringify(C.avatar.randomize(7, { hairFront: true }, base)) === JSON.stringify(rand) };
  });
  ok(r.layers.includes('core.avatar.hair-bob-back') && r.layers.indexOf('core.avatar.body-01') < r.layers.indexOf('core.avatar.face-round'), 'a hair pair is added and body is under the face');
  ok(!r.hat.includes('core.avatar.hair-bob-front') && r.hat.includes('core.avatar.hair-short-back'), 'a beanie hides the front hair and swaps the back hair');
  ok(r.prefixed, 'compose prefixes ids and paints the skin colour');
  ok(r.locked && r.same, 'randomize keeps a lock and is stable for a seed');
  srv.child.kill(); await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
