// The Cloudflare Pages /packs Function fails closed without a valid Access token.
import { generateKeyPairSync, createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const fn = await import(pathToFileURL(path.resolve(import.meta.dirname, '../deploy/cloudflare-pages/functions/packs/[[path]].js')).href);
let fails = 0; const ok = (c, s) => { console.log((c ? 'PASS ' : 'FAIL ') + s); if (!c) fails++; };
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256' });
const team = 'example-team.cloudflareaccess.com', AUD = 'aud123';
globalThis.fetch = async (u) => { if (String(u) === `https://${team}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] })); return new Response('', { status: 404 }); };
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(claims) {
  const h = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64u(claims);
  const s = createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
  return h + '.' + p + '.' + s;
}
const objs = { 'index.json': '{"schema":"cpa-pack-index/1","packs":[]}', 'a/1/a.zip.000': 'ZIPDATA' };
const PACKS = { async get(k) { return k in objs ? { body: objs[k], httpEtag: '"e"', writeHttpMetadata() {} } : null; }, async head(k) { return this.get(k); } };
const env = { PACKS, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: AUD };
const now = Math.floor(Date.now() / 1000);
const call = (hdrs, p, e) => fn.onRequest({ request: new Request('https://x.pages.dev/packs/' + p, { headers: hdrs || {} }), env: e || env, params: { path: p.split('/') } });
ok((await call({}, 'index.json')).status === 403, 'no token: 403');
ok((await call({ 'Cf-Access-Jwt-Assertion': jwt({ aud: [AUD], iss: `https://${team}`, exp: now + 600 }) }, 'index.json', { PACKS })).status === 403, 'no Access settings: 403 (fails closed)');
ok((await call({ 'Cf-Access-Jwt-Assertion': jwt({ aud: ['other'], iss: `https://${team}`, exp: now + 600 }) }, 'index.json')).status === 403, 'wrong audience: 403');
ok((await call({ 'Cf-Access-Jwt-Assertion': jwt({ aud: [AUD], iss: `https://${team}`, exp: now - 10 }) }, 'index.json')).status === 403, 'expired token: 403');
const good = jwt({ aud: [AUD], iss: `https://${team}`, exp: now + 600, email: 'someone@example.com' });
const tampered = good.split('.'); tampered[1] = b64u({ aud: [AUD], iss: `https://${team}`, exp: now + 99999 });
ok((await call({ 'Cf-Access-Jwt-Assertion': tampered.join('.') }, 'index.json')).status === 403, 'tampered token: 403');
const r = await call({ 'Cf-Access-Jwt-Assertion': good }, 'index.json');
ok(r.status === 200 && (await r.text()).includes('cpa-pack-index/1'), 'valid token: index.json served');
const r2 = await call({ Cookie: 'x=1; CF_Authorization=' + good }, 'a/1/a.zip.000');
ok(r2.status === 200 && /immutable/.test(r2.headers.get('Cache-Control')), 'valid cookie: pack part served, cached immutable');
ok((await call({ 'Cf-Access-Jwt-Assertion': good }, 'missing')).status === 404, 'missing object: 404');
process.exit(fails ? 1 : 0);
