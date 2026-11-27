// Cloudflare Pages Function: serve private sticker packs from an R2 bucket at /packs/*.
// Bindings / variables on the Pages project:
//   PACKS               R2 bucket binding (the bucket stays private; no public r2.dev URL)
//   ACCESS_TEAM_DOMAIN  e.g. "yourteam.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's AUD tag
// Fails closed: without a valid Cloudflare Access token for this app, nothing is served,
// even if the Access application is later removed or misconfigured.
let jwksCache = { at: 0, keys: null };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function jwks(team) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}
async function verifyAccess(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!team || !env.ACCESS_AUD) return 'no-access-config';
  let token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) { const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') || ''); token = m && m[1]; }
  if (!token) return 'no-token';
  const [h, p, s] = token.split('.'); if (!h || !p || !s) return 'malformed';
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (header.alg !== 'RS256') return 'alg';
  if (!aud.includes(env.ACCESS_AUD)) return 'aud';
  if (payload.iss !== `https://${team}`) return 'iss:' + String(payload.iss).slice(0, 80);
  if (!(payload.exp > now)) return 'expired';
  if (payload.nbf && payload.nbf > now + 60) return 'nbf';
  const jwk = (await jwks(team)).find(k => k.kid === header.kid); if (!jwk) return 'kid';
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(h + '.' + p))) ? 'ok' : 'signature';
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  let why = 'error'; try { why = await verifyAccess(request, env); } catch (e) { why = 'error:' + String(e && e.message || e).slice(0, 120); }
  if (why !== 'ok') console.log(JSON.stringify({ packs: 'denied', why, path: new URL(request.url).pathname, header: !!request.headers.get('Cf-Access-Jwt-Assertion'), cookie: /CF_Authorization=/.test(request.headers.get('Cookie') || '') }));
  if (why !== 'ok') return new Response('Sign-in required', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const key = (Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')) || 'index.json';
  if (key.includes('..') || key.startsWith('/')) return new Response('Bad path', { status: 400 });
  const obj = request.method === 'HEAD' ? await env.PACKS.head(key) : await env.PACKS.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Cache-Control', key === 'index.json' ? 'private, no-cache' : 'private, max-age=31536000, immutable');
  if (!headers.has('Content-Type')) headers.set('Content-Type', key.endsWith('.json') ? 'application/json' : 'application/octet-stream');
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}
