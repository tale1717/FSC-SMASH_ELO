function finalizedTournament(t){return t?.slug==='v3fgwg53'||t?.url==='v3fgwg53'||(/^FSC\b/i.test(t?.name||'')&&/Bracket.*#\s*6\b/i.test(t.name));}
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
    if (!['/me', '/tournaments', '/matches', '/rooms', '/lobby'].includes(path) && !/^\/(?:play|rooms)\/[a-z0-9-]+$/.test(path)) return reply(404, { error: 'Not found' });
    return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600'
    } });
  }
  if (!['GET', 'POST'].includes(request.method)) return reply(405, { error: 'Method not allowed' });
  if (path === '/lobby') return roomSafe(() => publicLobby(request, env, reply), reply);
  if (path.startsWith('/play/')) return roomSafe(() => playerRoom(request, env, path.split('/')[2], reply), reply);
  if (request.method === 'POST' && !path.startsWith('/rooms')) return reply(405, { error: 'Method not allowed' });
  if (path === '/') return reply(200, { service: 'FSC Smash Elo organizer API', status: 'ready' });
  if (!['/me', '/tournaments', '/matches', '/rooms', '/lobby'].includes(path) && !/^\/(?:play|rooms)\/[a-z0-9-]+$/.test(path)) return reply(404, { error: 'Not found' });
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
  if (path.startsWith('/rooms')) return roomSafe(() => organizerRooms(request, env, fetcher, account.localId, reply), reply);
  if (path !== '/me') return liveData(request, path, env, fetcher, reply);
  return reply(200, { uid: account.localId, role });
}
export default { fetch(request, env) { return handle(request, env); } };

class ChallongeError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
const collectionCaches = new WeakMap();
export async function collection(path, kind, key, fetcher, signal, filters = {}) {
  let cache=collectionCaches.get(fetcher);if(!cache){cache=new Map();collectionCaches.set(fetcher,cache)}
  const cacheKey=JSON.stringify([path,key,filters]);const existing=cache.get(cacheKey);
  if(existing&&existing.until>Date.now())return structuredClone(await existing.value);
  const ttl=path.endsWith('/participants')?300000:path.endsWith('/matches')?10000:60000;
  const entry={until:Date.now()+ttl,value:fetchCollection(path,kind,key,fetcher,signal,filters)};
  if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(cacheKey,entry);
  try{return structuredClone(await entry.value)}catch(e){if(cache.get(cacheKey)===entry)cache.delete(cacheKey);throw e}
}
async function fetchCollection(path, kind, key, fetcher, signal, filters = {}) {
  if (!/^tournaments(?:\/\d+\/(?:participants|matches))?$/.test(path)) throw new ChallongeError('Invalid endpoint', 400);
  const rows = [], seen = new Set();
  for (let page = 1; page <= 12; page++) {
    const query = new URLSearchParams({ ...filters, page: String(page), per_page: '25' });
    const context = path + '.json, page ' + page;
    let response;
    try {
      response = await fetcher('https://api.challonge.com/v2.1/' + path + '.json?' + query, {
        method: 'GET', redirect: 'manual', signal,
        headers: { Authorization: key, 'Authorization-Type': 'v1', Accept: 'application/json',
          'Content-Type': 'application/vnd.api+json',
          'User-Agent': 'FSC-Smash-Elo/1.0 (+https://github.com/tale1717/FSC-SMASH_ELO)' }
      });
    } catch (error) {
      if (signal?.aborted || ['TimeoutError', 'AbortError'].includes(error?.name)) {
        throw new ChallongeError('Challonge read timed out (' + context + ').', 504);
      }
      throw new ChallongeError('Worker could not connect to Challonge (' + context + '). No HTTP response was received.');
    }
    // Never forward the credential to a redirect destination.
    if (response.status >= 300 && response.status < 400) {
      throw new ChallongeError('Challonge returned HTTP ' + response.status + ' redirect (' + context + '). Redirect was not followed.');
    }
    let body;
    try { body = await response.text(); }
    catch {
      throw new ChallongeError('Challonge response body could not be read (' + context + ').',
        signal?.aborted ? 504 : 502);
    }
    const challenge = /cf-chl-|just a moment|cloudflare/i.test(body.slice(0, 16384));
    if (!response.ok) {
      const hints = { 401: 'Check the Challonge account API key.', 403: 'Check account access.',
        429: 'Request limit reached. Wait before refreshing.' };
      throw new ChallongeError('Challonge HTTP ' + response.status + ' (' + context + '). ' +
        (challenge ? 'Response indicates a Cloudflare/security block. ' : '') +
        (hints[response.status] || 'Request failed.'), response.status === 429 ? 429 : 502);
    }
    let payload;
    try { payload = JSON.parse(body); }
    catch {
      throw new ChallongeError('Challonge returned non-JSON content with HTTP ' + response.status +
        ' (' + context + ').' + (challenge ? ' Response indicates a Cloudflare/security challenge.' : ''));
    }
    if (!payload || typeof payload !== 'object' || payload.errors || !Array.isArray(payload.data)) {
      throw new ChallongeError('Unexpected Challonge collection format (' + context + ').');
    }
    if (!payload.data.length) return rows;
    for (const row of payload.data) {
      const id = String(row?.id ?? '');
      if (row?.type !== kind || (typeof row.attributes !== 'object' || !row.attributes || Array.isArray(row.attributes)) || !/^\d+$/.test(id) || seen.has(id)) {
        throw new ChallongeError('Invalid or repeated Challonge data. No partial list was loaded.');
      }
      seen.add(id); rows.push({ ...row, id });
    }
    if(payload.links && payload.links.next === null)return rows;
  }
  throw new ChallongeError('Challonge pagination limit reached. No partial list was loaded.');
}
async function activeTournaments(key, fetcher, signal, env = {}) {
  const rows = await collection('tournaments', 'tournament', key, fetcher, signal, { state: 'underway' });
  return rows.filter(({ attributes: a }) =>
    typeof a.name === 'string' && (a.name.startsWith('FSC Fall Bracket') || a.name === 'FSC Test Bracket' || a.url === 'v3fgwg53') &&
    a.game_name === 'Super Smash Bros. Ultimate' && !a.teams && !a.group_stage_enabled &&
    (!a.state || a.state === 'underway')
  ).map(({ id, attributes: a }) => ({
    id, name: a.name, url: bracketUrl(a.url), isTest: /\b(test|dummy|practice)\b/i.test(a.name),
    startsAt: a.started_at || a.timestamps?.started_at || a.starts_at || null
  })).sort((a, b) => String(b.startsAt || '').localeCompare(String(a.startsAt || '')) || b.id.localeCompare(a.id));
}
function bracketUrl(slug) {
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slug)) return null;
  return 'https://challonge.com/' + slug;
}
export function openMatches(rows, participants) {
  const names = new Map(participants.map(p => [String(p.id), p.attributes.name]));
  const matches = [];
  let unresolved = 0;
  for (const row of rows) {
    const a = row.attributes;
    if (!['open', 'underway'].includes(a.state) || a.winner_id != null) continue;
    // Prefer explicit player relationships when supplied; null slots remain unresolved.
    const slot = name => a.relationships?.[name] ?? row.relationships?.[name];
    const hasSlots = ['player1', 'player2'].some(name => slot(name) !== undefined);
    const sources = hasSlots
      ? ['player1', 'player2'].map(name => slot(name)?.data?.id)
      : Array.isArray(a.points_by_participant) && a.points_by_participant.length === 2
        ? a.points_by_participant.map(p => p?.participant_id) : [null, null];
    // The fallback identifies the two entrants, not a guessed score or bracket position.
    const ids = sources.map(id => id == null ? null : String(id));
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
  if (/[^\x21-\x7e]/.test(key)) return reply(503, { error: 'The CHALLONGE_API_KEY secret contains spaces or invalid characters. Re-enter the plain key without quotes.' });
  const signal = AbortSignal.timeout(25000);
  try {
    const tournaments = await activeTournaments(key, fetcher, signal, env);
    if (path === '/tournaments') return reply(200, { tournaments, fetchedAt: new Date().toISOString() });
    const id = new URL(request.url).searchParams.get('tournament');
    if (!id || !/^\d+$/.test(id)) return reply(400, { error: 'Select a tournament from the list.' });
    const tournament = tournaments.find(t => t.id === id);
    if (!tournament) return reply(409, { error: 'This tournament is no longer in the active FSC bracket list. Reload tournaments.' });
    // Fetch participants before matches so the match snapshot is the most recent.
    const participants = await collection('tournaments/' + id + '/participants', 'participant', key, fetcher, signal);
    const rows = await collection('tournaments/' + id + '/matches', 'match', key, fetcher, signal);
    return reply(200, { tournament, ...openMatches(rows, participants), fetchedAt: new Date().toISOString() });
  } catch (error) {
    return reply(error instanceof ChallongeError ? error.status : 502,
      { error: error instanceof ChallongeError ? error.message : 'Challonge data processing failed after the request. No match list was loaded.' });
  }
}

// Live match data stays in MATCH_DB. This Worker never writes Elo or Challonge results.
export const STAGES = [
  ['Pokémon Stadium 2','pokemon-stadium-2'],['Small Battlefield','small-battlefield'],
  ['Battlefield','battlefield'],['Town and City','town-and-city'],['Smashville','smashville'],
  ['Final Destination','final-destination'],['Kalos Pokémon League','kalos-pokemon-league'],['Hollow Bastion','hollow-bastion']
].map(([name,image],i)=>({name,image:'assets/stages/'+image+'.jpg',counter:i>=5}));
export const CHARACTERS = ['Mario','Donkey Kong','Link','Samus','Dark Samus','Yoshi','Kirby','Fox','Pikachu','Luigi','Ness','Captain Falcon','Jigglypuff','Peach','Daisy','Bowser','Ice Climbers','Sheik','Zelda','Dr. Mario','Pichu','Falco','Marth','Lucina','Young Link','Ganondorf','Mewtwo','Roy','Chrom','Mr. Game & Watch','Meta Knight','Pit','Dark Pit','Zero Suit Samus','Wario','Snake','Ike','Pokémon Trainer','Diddy Kong','Lucas','Sonic','King Dedede','Olimar','Lucario','R.O.B.','Toon Link','Wolf','Villager','Mega Man','Wii Fit Trainer','Rosalina & Luma','Little Mac','Greninja','Mii Brawler','Mii Swordfighter','Mii Gunner','Palutena','Pac-Man','Robin','Shulk','Bowser Jr.','Duck Hunt','Ryu','Ken','Cloud','Corrin','Bayonetta','Inkling','Ridley','Simon','Richter','King K. Rool','Isabelle','Incineroar','Piranha Plant','Joker','Hero','Banjo & Kazooie','Terry','Byleth','Min Min','Steve','Sephiroth','Pyra/Mythra','Kazuya','Sora'].sort();
class RoomError extends Error { constructor(message,status=400){super(message);this.status=status;} }
function requireRoom(condition,message,status=409){if(!condition)throw new RoomError(message,status);}
async function roomSafe(action,reply){try{return await action()}catch(e){return reply(e instanceof RoomError?e.status:503,{error:e instanceof RoomError?e.message:'Match storage is unavailable. Check the MATCH_DB binding and schema, then retry.'})}}
async function roomBody(request){
  requireRoom(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Send JSON.',415);
  const text=await request.text();requireRoom(text.length<=4096,'Request too large.',413);
  try {const body=JSON.parse(text);requireRoom(body&&typeof body==='object'&&!Array.isArray(body),'Invalid request.',400);return body}
  catch(e){if(e instanceof RoomError)throw e;throw new RoomError('Invalid JSON.')}
}
function database(env){requireRoom(env.MATCH_DB,'Add the MATCH_DB D1 binding and run schema.sql first.',503);return env.MATCH_DB;}
function newCode(){
  // Rejection sampling keeps every six-digit code equally likely, including leading zeroes.
  let value;do{value=crypto.getRandomValues(new Uint32Array(1))[0]}while(value>=4294000000);
  return String(value%1000000).padStart(6,'0');
}
async function distinctCode(room,...otherHashes){
  let code;do{code=newCode()}while(otherHashes.includes(await codeHash(room,code)));return code;
}
async function publicLobby(request,env,reply){
  requireRoom(request.method==='GET','Method not allowed.',405);
  const rows=await database(env).prepare('SELECT id,state,created_at FROM match_rooms WHERE expires_at > ? ORDER BY created_at DESC LIMIT 300').bind(Date.now()).all();
  // Publish only the information needed to identify a set, never codes or private room state.
  const rooms=rows.results.flatMap(row=>{
    const s=JSON.parse(row.state);
    if(s.phase==='approved'||finalizedTournament(s.tournament))return [];
    return [{id:row.id,tournament:{id:s.tournament.id,name:s.tournament.name},match:{identifier:s.match.identifier,players:s.match.players.map(p=>({name:p.name}))},bestOf:s.bestOf,isTest:s.isTest===true}];
  });
  return reply(200,{rooms});
}
async function codeHash(room,code){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(room+':'+code.trim().toUpperCase()))),n=>n.toString(16).padStart(2,'0')).join('');}
export function initialRoom(tournament,match,bestOf){return {tournament,match,bestOf,isTest:tournament.isTest===true,phase:'joining',joined:[false,false],characters:[null,null],choices:[null,null],winnerVotes:[null,null],confirmed:[false,false],records:[],wins:[0,0],game:1,stage:null,banned:[],step:0,first:null,previous:null,log:[]};}
function nextGame(s){s.phase='characters';s.characters=[null,null];s.choices=[null,null];s.winnerVotes=[null,null];s.stage=null;s.banned=[];s.step=0;s.first=null;}
export function turnOf(s){return s.game===1?(s.step===1?1-s.first:s.first):(s.step===0?s.previous:1-s.previous);}
function allowedStages(s){return STAGES.filter(x=>s.game>1||!x.counter).map(x=>x.name);}
function lockStage(s,stage){s.stage=stage;s.phase='result';s.winnerVotes=[null,null];}
// Actor is derived exclusively from the stored code hash, never from request JSON.
export function reduceRoom(original,actor,input,random=()=>crypto.getRandomValues(new Uint8Array(1))[0]%2){
  const s=structuredClone(original);requireRoom(actor===0||actor===1,'Invalid player.',403);
  requireRoom(!['approved','pending','review'].includes(s.phase)||input.action==='confirm','This set is awaiting review.');
  if(input.action==='join'){
    requireRoom(!s.joined[actor],'Already joined.');s.joined[actor]=true;
    if(s.joined.every(Boolean)&&s.phase==='joining')s.phase='characters';return s;
  }
  requireRoom(s.joined[actor],'Join this match first.',403);
  if(input.action==='character'){
    requireRoom(s.phase==='characters','Character selection is closed.');
    requireRoom(CHARACTERS.includes(input.character),'Choose a character.',400);s.characters[actor]=input.character;
    if(s.characters.every(Boolean))s.phase='agreement';return s;
  }
  if(input.action==='agree'){
    requireRoom(s.phase==='agreement','Stage agreement is closed.');requireRoom(allowedStages(s).includes(input.stage),'Invalid stage.',400);
    s.choices[actor]=input.stage;if(s.choices[0]===s.choices[1])lockStage(s,input.stage);return s;
  }
  if(input.action==='standard'){
    requireRoom(s.phase==='agreement','Striking has already begun.');s.phase='striking';s.first=s.game===1?random():null;return s;
  }
  if(input.action==='stages'){
    requireRoom(s.phase==='striking','Striking is closed.');requireRoom(turnOf(s)===actor,'It is the other player’s turn.',403);
    const picking=s.game>1&&s.step===1,needed=s.game===1?[1,2,1][s.step]:(picking?1:3),values=input.stages;
    requireRoom(Array.isArray(values)&&values.length===needed&&new Set(values).size===needed&&values.every(x=>allowedStages(s).includes(x)&&!s.banned.includes(x)),'Choose the required available stages.',400);
    if(picking){lockStage(s,values[0]);return s;}
    s.banned.push(...values);s.log.push(s.match.players[actor].name+' struck '+values.join(', '));s.step++;
    if(s.game===1&&s.step===3)lockStage(s,allowedStages(s).find(x=>!s.banned.includes(x)));return s;
  }
  if(input.action==='winner'){
    requireRoom(s.phase==='result','This game is not ready for a result.');requireRoom(input.winner===0||input.winner===1,'Choose the game winner.',400);
    s.winnerVotes[actor]=input.winner;
    if(s.winnerVotes[0]!==null&&s.winnerVotes[0]===s.winnerVotes[1]){
      s.records.push({game:s.game,stage:s.stage,characters:[...s.characters],winner:input.winner});s.wins[input.winner]++;s.previous=input.winner;
      if(s.wins[input.winner]===Math.ceil(s.bestOf/2)){s.phase='review';s.confirmed=[false,false];}
      else{s.game++;nextGame(s);}
    }return s;
  }
  if(input.action==='confirm'){
    requireRoom(s.phase==='review','The set is not ready for confirmation.');requireRoom(!s.confirmed[actor],'You already confirmed.');s.confirmed[actor]=true;
    if(s.confirmed.every(Boolean))s.phase='pending';return s;
  }
  throw new RoomError('Unknown player action.');
}
function publicRoom(row,actor=null){const state=JSON.parse(row.state);delete state._codes;return {id:row.id,revision:row.revision,expiresAt:row.expires_at,actor,state,stages:STAGES,characters:CHARACTERS};}
function organizerRoom(row){const result=publicRoom(row);result.codes=JSON.parse(row.state)._codes||[null,null];return result;}
async function getRoom(db,id){requireRoom(/^[a-z0-9-]{36}$/.test(id),'Room not found.',404);const row=await db.prepare('SELECT * FROM match_rooms WHERE id = ?').bind(id).first();requireRoom(row,'Room not found.',404);return row;}
async function saveRoom(db,row,state){
  const result=await db.prepare('UPDATE match_rooms SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state),row.id,row.revision).run();
  requireRoom(result.meta.changes===1,'The match changed on another device. Refresh and try again.');return {...row,state:JSON.stringify(state),revision:row.revision+1};
}
async function playerRoom(request,env,id,reply){
  const db=database(env),row=await getRoom(db,id);requireRoom(!finalizedTournament(JSON.parse(row.state).tournament),'This tournament is finalized. View its published results.',410);requireRoom(Date.now()<row.expires_at,'This room expired. Contact the TO.',410);
  const code=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');requireRoom(/^(?:[0-9]{6}|[a-f0-9]{24})$/i.test(code),'Enter your private player code.',401);
  const hash=await codeHash(id,code),actor=hash===row.code_a?0:hash===row.code_b?1:null;requireRoom(actor!==null,'Incorrect player code.',403);
  if(request.method==='GET'){if(new URL(request.url).searchParams.get('since')===String(row.revision))return reply(200,{unchanged:true,revision:row.revision});return reply(200,publicRoom(row,actor));}
  requireRoom(request.method==='POST','Method not allowed.',405);const body=await roomBody(request);requireRoom(body.revision===row.revision,'The match changed. Refresh before acting.');
  return reply(200,publicRoom(await saveRoom(db,row,reduceRoom(JSON.parse(row.state),actor,body)),actor));
}
async function organizerRooms(request,env,fetcher,uid,reply){
  const db=database(env),url=new URL(request.url),parts=url.pathname.split('/');
  if(parts[2]){
    const row=await getRoom(db,parts[2]);
    if(request.method==='GET')return reply(200,organizerRoom(row));
    requireRoom(!finalizedTournament(JSON.parse(row.state).tournament),'This tournament is finalized. Its rooms are archived.',410);
    const input=await roomBody(request);requireRoom(input.revision===row.revision,'The room changed. Refresh before acting.');const state=JSON.parse(row.state);
    if(input.action==='organizer-result'){
      requireRoom(state.phase!=='approved','This room is already approved.');
      const scores=input.scores;requireRoom(Array.isArray(scores)&&scores.length===2&&scores.every(n=>Number.isInteger(n)&&n>=0)&&Math.max(...scores)===Math.ceil(state.bestOf/2)&&Math.min(...scores)<Math.max(...scores),'Enter a valid final score.',400);
      requireRoom(typeof input.note==='string'&&input.note.trim(),'Add a correction note.',400);
      const records=input.records||[];requireRoom(Array.isArray(records)&&records.length<=5,'Invalid game records.',400);
      if(records.length){const wins=[0,0];requireRoom(records.length===scores[0]+scores[1],'Game count disagrees with score.',400);for(const [i,g] of records.entries()){requireRoom(g.game===i+1&&[0,1].includes(g.winner)&&typeof g.stage==='string'&&g.stage.length<=100&&Array.isArray(g.characters)&&g.characters.length===2&&g.characters.every(c=>typeof c==='string'&&c.length<=100),'Invalid game details.',400);wins[g.winner]++;requireRoom(i===records.length-1||Math.max(...wins)<Math.ceil(state.bestOf/2),'Games continue after the set ended.',400)}requireRoom(wins.every((n,i)=>n===scores[i]),'Game winners disagree with score.',400)}
      state.records=records;state.wins=scores;state.phase='approved';state.approvedBy=uid;state.approvedAt=new Date().toISOString();state.organizerNote=input.note.slice(0,500);state.confirmed=[false,false];
    }else if(input.action==='approve'){
      requireRoom(state.phase==='pending'&&state.confirmed.every(Boolean),'Both players must confirm first.');state.phase='approved';state.approvedBy=uid;state.approvedAt=new Date().toISOString();
    }else if(input.action==='correct'){
      requireRoom(['review','pending'].includes(state.phase),'Only unapproved final results can be corrected.');const last=state.records.pop();requireRoom(last,'No completed game to correct.');
      state.wins[last.winner]--;state.game=last.game;state.characters=last.characters;state.stage=last.stage;state.phase='result';state.winnerVotes=[null,null];state.confirmed=[false,false];state.previous=state.records.at(-1)?.winner??null;
    }else if(input.action==='reissue'){
      requireRoom(input.player===0||input.player===1,'Choose a player.',400);requireRoom(!['approved'].includes(state.phase),'This set is already approved.');const code=await distinctCode(row.id,row.code_a,row.code_b),hash=await codeHash(row.id,code);
      const column=input.player===0?'code_a':'code_b';
      state._codes||=[null,null];state._codes[input.player]=code;
      const updated=await db.prepare('UPDATE match_rooms SET '+column+' = ?, state = ?, revision = revision + 1, expires_at = ? WHERE id = ? AND revision = ?').bind(hash,JSON.stringify(state),Date.now()+48*3600000,row.id,row.revision).run();
      requireRoom(updated.meta.changes===1,'Room changed; retry.');return reply(200,{code,player:input.player});
    }else throw new RoomError('Unknown organizer action.');
    return reply(200,publicRoom(await saveRoom(db,row,state)));
  }
  if(request.method==='GET'&&url.searchParams.get('archive')==='1'){
    let cursor=null;const raw=url.searchParams.get('cursor');
    if(raw){try{cursor=JSON.parse(atob(raw))}catch{throw new RoomError('Invalid archive cursor.',400)}requireRoom(cursor&&Number.isSafeInteger(cursor.time)&&/^[a-z0-9-]{36}$/.test(cursor.id),'Invalid archive cursor.',400)}
    const rows=cursor?await db.prepare('SELECT * FROM match_rooms WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT 51').bind(cursor.time,cursor.time,cursor.id).all():await db.prepare('SELECT * FROM match_rooms ORDER BY created_at DESC, id DESC LIMIT 51').bind().all();
    const page=rows.results.slice(0,50),last=page.at(-1);
    const rooms=page.filter(r=>{const s=JSON.parse(r.state);return s.phase==='approved'||r.expires_at<=Date.now()||finalizedTournament(s.tournament)}).map(r=>({...publicRoom(r),createdAt:r.created_at}));
    return reply(200,{rooms,next:rows.results.length>50?btoa(JSON.stringify({time:last.created_at,id:last.id})):null});
  }
  if(request.method==='GET'){
    const tournament=url.searchParams.get('tournament');
    requireRoom(!tournament||/^[a-zA-Z0-9:-]+$/.test(tournament),'Invalid tournament.',400);
    const rows=await db.prepare(tournament?'SELECT * FROM match_rooms WHERE tournament_id = ? ORDER BY created_at DESC LIMIT 300':'SELECT * FROM match_rooms WHERE expires_at > ? ORDER BY created_at DESC LIMIT 300').bind(tournament||Date.now()).all();
    return reply(200,{rooms:rows.results.filter(r=>r.expires_at>Date.now()&&JSON.parse(r.state).phase!=='approved'&&!finalizedTournament(JSON.parse(r.state).tournament)).map(r=>organizerRoom(r))});
  }
  const input=await roomBody(request);requireRoom(/^\d+$/.test(input.tournament||'')&&/^\d+$/.test(input.match||'')&&[3,5].includes(input.bestOf),'Choose a match and best-of 3 or 5.',400);
  const key=(env.CHALLONGE_API_KEY||'').trim();requireRoom(key&&!/[^\x21-\x7e]/.test(key),'Configure the Challonge API key.',503);
  const signal=AbortSignal.timeout(25000),events=await activeTournaments(key,fetcher,signal,env),event=events.find(e=>e.id===input.tournament);
  requireRoom(event,'Tournament is no longer available. Refresh the list.');
  const people=await collection('tournaments/'+event.id+'/participants','participant',key,fetcher,signal);
  const matches=await collection('tournaments/'+event.id+'/matches','match',key,fetcher,signal);
  const match=openMatches(matches,people).matches.find(m=>m.id===input.match);requireRoom(match,'This set is no longer open. Refresh the list.');
  const id=crypto.randomUUID(),first=newCode(),firstHash=await codeHash(id,first);
  const codes=[first,await distinctCode(id,firstHash)],hashes=await Promise.all(codes.map(c=>codeHash(id,c))),state=initialRoom(event,match,input.bestOf),now=Date.now();
  state._codes=codes;
  const inserted=await db.prepare('INSERT OR IGNORE INTO match_rooms (id,tournament_id,match_id,code_a,code_b,state,revision,created_at,expires_at) VALUES (?,?,?,?,?,?,0,?,?)').bind(id,event.id,match.id,...hashes,JSON.stringify(state),now,now+48*3600000).run();
  requireRoom(inserted.meta.changes===1,'A room already exists for this set. Refresh rooms; reissue codes there if necessary.');
  return reply(201,{room:publicRoom({id,revision:0,state:JSON.stringify(state),expires_at:now+48*3600000}),codes});
}



