const PROJECT = 'fsc-smash-elo';
const ORIGINS = new Set(['https://fsc-smash-elo.web.app', 'https://fsc-smash-elo.firebaseapp.com']);

function claims(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
}

export async function handle(request, env, fetcher = fetch) {
  const origin = request.headers.get('Origin');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
  if (origin && !ORIGINS.has(origin)) return reply(403, { error: 'Origin not allowed' });
  const path = new URL(request.url).pathname;
  if (request.method === 'OPTIONS') {
    if (path !== '/me') return reply(404, { error: 'Not found' });
    return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '600'
    } });
  }
  if (request.method !== 'GET') return reply(405, { error: 'Method not allowed' });
  if (path === '/') return reply(200, { service: 'FSC Smash Elo organizer API', status: 'ready' });
  if (path !== '/me') return reply(404, { error: 'Not found' });
  if (!env.FIREBASE_WEB_API_KEY || !env.OWNER_UID) return reply(503, { error: 'API configuration required' });
  const bearer = request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(bearer) || bearer.length > 16000) return reply(401, { error: 'Sign-in required' });
  const token = bearer.slice(7);
  let payload;
  try {
    // These checks only reject malformed claims. Google verifies the token below.
    payload = claims(token);
    const now = Date.now() / 1000;
    if (payload.aud !== PROJECT || payload.iss !== 'https://securetoken.google.com/' + PROJECT ||
        typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
        !Number.isFinite(payload.exp) || payload.exp <= now ||
        !Number.isFinite(payload.iat) || payload.iat > now ||
        !Number.isFinite(payload.auth_time) || payload.auth_time > now ||
        !['google.com', 'password'].includes(payload.firebase?.sign_in_provider)) throw new Error('Invalid claims');
  } catch { return reply(401, { error: 'Invalid session' }); }
  let account;
  try {
    const response = await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
      encodeURIComponent(env.FIREBASE_WEB_API_KEY), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(10000)
    });
    if (response.status === 429 || response.status >= 500) return reply(503, { error: 'Authentication temporarily unavailable' });
    if (!response.ok) return reply(401, { error: 'Invalid session' });
    const data = await response.json();
    if (data.users?.length !== 1) return reply(401, { error: 'Invalid session' });
    account = data.users[0];
    if (account.localId !== payload.sub || account.disabled ||
        (account.validSince && payload.auth_time < Number(account.validSince))) return reply(401, { error: 'Invalid session' });
  } catch { return reply(503, { error: 'Authentication temporarily unavailable' }); }
  // Approval is controlled by the owner in Cloudflare, never by the browser.
  const approved = new Set((env.ORGANIZER_UIDS || '').split(',').map(value => value.trim()).filter(Boolean));
  const role = account.localId === env.OWNER_UID ? 'owner' : approved.has(account.localId) ? 'organizer' : null;
  if (!role) return reply(403, { error: 'Organizer access not approved' });
  // Require the provider used for this session, not merely a linked provider.
  const requiredProvider = role === 'owner' ? 'google.com' : 'password';
  if (payload.firebase.sign_in_provider !== requiredProvider) {
    return reply(403, { error: 'Sign-in method not permitted for this role' });
  }
  return reply(200, { uid: account.localId, role });
}
export default { fetch(request, env) { return handle(request, env); } };
