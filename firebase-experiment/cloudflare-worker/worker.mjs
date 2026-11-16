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
    if (!['/me', '/tournaments', '/matches'].includes(path)) return reply(404, { error: 'Not found' });
    return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '600'
    } });
  }
  if (request.method !== 'GET') return reply(405, { error: 'Method not allowed' });
  if (path === '/') return reply(200, { service: 'FSC Smash Elo organizer API', status: 'ready' });
  if (!['/me', '/tournaments', '/matches'].includes(path)) return reply(404, { error: 'Not found' });
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
  if (path !== '/me') return liveData(request, path, env, fetcher, reply);
  return reply(200, { uid: account.localId, role });
}
export default { fetch(request, env) { return handle(request, env); } };

class ChallongeError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export async function collection(path, kind, key, fetcher, signal, filters = {}) {
  if (!/^tournaments(?:\/\d+\/(?:participants|matches))?$/.test(path)) throw new ChallongeError('Invalid endpoint', 400);
  const rows = [], seen = new Set();
  for (let page = 1; page <= 12; page++) {
    const query = new URLSearchParams({ ...filters, page: String(page), per_page: '25' });
    const response = await fetcher('https://api.challonge.com/v2.1/' + path + '.json?' + query, {
      method: 'GET', redirect: 'error', signal,
      headers: { Authorization: key, 'Authorization-Type': 'v1', Accept: 'application/json',
        'Content-Type': 'application/vnd.api+json',
        'User-Agent': 'FSC-Smash-Elo/1.0 (+https://github.com/tale1717/FSC-SMASH_ELO)' }
    });
    if (!response.ok) {
      const hints = { 401: 'Challonge rejected the API key.', 403: 'Challonge denied this request; account permissions or a security block may be involved.',
        429: 'Challonge request limit reached. Wait before refreshing.' };
      throw new ChallongeError(hints[response.status] || 'Challonge request failed.', response.status === 429 ? 429 : 502);
    }
    const payload = await response.json();
    if (payload.errors || !Array.isArray(payload.data)) throw new ChallongeError('Unexpected Challonge response.');
    if (!payload.data.length) return rows;
    for (const row of payload.data) {
      const id = String(row?.id ?? '');
      if (row?.type !== kind || !row.attributes || !/^\d+$/.test(id) || seen.has(id)) {
        throw new ChallongeError('Invalid or repeated Challonge data. No partial list was loaded.');
      }
      seen.add(id); rows.push({ ...row, id });
    }
  }
  throw new ChallongeError('Challonge pagination limit reached. No partial list was loaded.');
}
async function activeTournaments(key, fetcher, signal) {
  const rows = await collection('tournaments', 'tournament', key, fetcher, signal, { state: 'underway' });
  return rows.filter(({ attributes: a }) =>
    typeof a.name === 'string' && a.name.startsWith('FSC Fall Bracket') &&
    a.game_name === 'Super Smash Bros. Ultimate' && !a.teams && !a.group_stage_enabled &&
    (!a.state || a.state === 'underway')
  ).map(({ id, attributes: a }) => ({
    id, name: a.name, url: bracketUrl(a.url),
    startsAt: a.started_at || a.timestamps?.started_at || a.starts_at || null
  })).sort((a, b) => String(b.startsAt || '').localeCompare(String(a.startsAt || '')) || b.id.localeCompare(a.id));
}
function bracketUrl(slug) {
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slug)) return null;
  return 'https://challonge.com/' + slug;
}
export function openMatches(rows, participants) {
  const names = new Map(participants.map(p => [p.id, p.attributes.name]));
  const matches = [];
  let unresolved = 0;
  for (const row of rows) {
    const a = row.attributes;
    if (!['open', 'underway'].includes(a.state) || a.winner_id != null) continue;
    const relationships = a.relationships || row.relationships || {};
    const ids = ['player1', 'player2'].map(slot => {
      const id = relationships[slot]?.data?.id;
      return id == null ? null : String(id);
    });
    // Do not guess bracket slots from participant order or score arrays.
    if (ids.some(id => !id || !names.has(id)) || ids[0] === ids[1]) { unresolved++; continue; }
    matches.push({
      id: row.id, identifier: String(a.identifier || row.id),
      round: Number.isInteger(a.round) ? a.round : null,
      order: Number.isFinite(a.suggested_play_order) ? a.suggested_play_order : null,
      state: a.state === 'underway' || a.underway_at || a.timestamps?.underway_at ? 'underway' : 'open',
      players: ids.map(id => ({ id, name: String(names.get(id) || 'Unnamed participant') }))
    });
  }
  matches.sort((a,b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id, undefined, { numeric:true }));
  return { matches, unresolved };
}
async function liveData(request, path, env, fetcher, reply) {
  const key = (env.CHALLONGE_API_KEY || '').trim();
  if (!key) return reply(503, { error: 'Add the CHALLONGE_API_KEY secret to the Worker first.' });
  const signal = AbortSignal.timeout(25000);
  try {
    const tournaments = await activeTournaments(key, fetcher, signal);
    if (path === '/tournaments') return reply(200, { tournaments, fetchedAt: new Date().toISOString() });
    const id = new URL(request.url).searchParams.get('tournament');
    if (!id || !/^\d+$/.test(id)) return reply(400, { error: 'Select a tournament from the list.' });
    const tournament = tournaments.find(t => t.id === id);
    if (!tournament) return reply(409, { error: 'This tournament is no longer in the active FSC Fall list. Reload tournaments.' });
    // Fetch participants before matches so the match snapshot is the most recent.
    const participants = await collection('tournaments/' + id + '/participants', 'participant', key, fetcher, signal);
    const rows = await collection('tournaments/' + id + '/matches', 'match', key, fetcher, signal);
    return reply(200, { tournament, ...openMatches(rows, participants), fetchedAt: new Date().toISOString() });
  } catch (error) {
    return reply(error instanceof ChallongeError ? error.status : 502,
      { error: error instanceof ChallongeError ? error.message : 'Could not read Challonge. Try refreshing again shortly.' });
  }
}
