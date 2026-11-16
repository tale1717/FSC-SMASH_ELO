import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, collection, openMatches } from './worker.mjs';
const now = Math.floor(Date.now()/1000);
const env = { FIREBASE_WEB_API_KEY: 'test-key', OWNER_UID: 'owner', ORGANIZER_UIDS: ' invited ' };
function token(uid = 'owner', changes = {}) {
  const data = { aud: 'fsc-smash-elo', iss: 'https://securetoken.google.com/fsc-smash-elo',
    sub: uid, exp: now + 3600, iat: now - 10, auth_time: now - 10,
    firebase: { sign_in_provider: uid === 'owner' ? 'google.com' : 'password' }, ...changes };
  return 'header.' + Buffer.from(JSON.stringify(data)).toString('base64url') + '.signature';
}
function request(value, origin = 'https://fsc-smash-elo.web.app') {
  return new Request('https://api.example/me', { headers: { Origin: origin, ...(value ? { Authorization: 'Bearer ' + value } : {}) } });
}
const google = (uid, extra = {}) => async () => Response.json({ users: [{ localId: uid, ...extra }] });
test('owner and invited organizer receive their roles', async () => {
  for (const [uid, role] of [['owner','owner'], ['invited','organizer']]) {
    const r = await handle(request(token(uid)), env, google(uid));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { uid, role });
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
});
test('valid but unapproved account is denied', async () => {
  assert.equal((await handle(request(token('stranger')), env, google('stranger'))).status,403);
});
test('forged owner claim cannot bypass Google verification', async () => {
  assert.equal((await handle(request(token()), env, async () => new Response('{}', { status:400 }))).status,401);
});
test('disabled, revoked, and mismatched accounts are denied', async () => {
  for (const [uid, extra] of [['owner',{disabled:true}], ['owner',{validSince:String(now)}], ['other',{}]]) {
    assert.equal((await handle(request(token()),env,google(uid,extra))).status,401);
  }
});
test('invalid token, wrong project, expired and anonymous tokens are rejected before lookup', async () => {
  for (const value of [null,'bad',token('owner',{aud:'other'}),token('owner',{exp:now-1}),
    token('owner',{firebase:{sign_in_provider:'anonymous'}})]) {
    assert.equal((await handle(request(value),env,async()=>{throw new Error('Must not call');})).status,401);
  }
});
test('untrusted browser origin is denied', async () => {
  const r=await handle(request(token(),'https://evil.example'),env,google('owner'));
  assert.equal(r.status,403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
});
test('upstream failure and missing configuration fail closed', async () => {
  assert.equal((await handle(request(token()),{},google('owner'))).status,503);
  assert.equal((await handle(request(token()),env,async()=>{throw new Error('offline');})).status,503);
});
test('lookup sends token only to Google with expected key', async () => {
  const value=token();
  const r=await handle(request(value),env,async(url,options)=>{
    assert.equal(url,'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=test-key');
    assert.deepEqual(JSON.parse(options.body),{idToken:value});
    return Response.json({users:[{localId:'owner'}]});
  });
  assert.equal(r.status,200);
});
test('CORS preflight and unknown mutation routes', async () => {
  const r=await handle(new Request('https://api.example/me',{method:'OPTIONS',headers:{Origin:'https://fsc-smash-elo.web.app'}}),env);
  assert.equal(r.status,204);
  assert.equal((await handle(new Request('https://api.example/me',{method:'POST'}),env)).status,405);
  assert.equal((await handle(new Request('https://api.example/refresh'),env)).status,404);
});

test('roles require their designated session provider even with linked accounts', async () => {
  for (const [uid, provider, expected] of [
    ['owner', 'google.com', 200],
    ['owner', 'password', 403],
    ['invited', 'password', 200],
    ['invited', 'google.com', 403],
    ['stranger', 'google.com', 403],
    ['stranger', 'password', 403]
  ]) {
    const value = token(uid, { firebase: { sign_in_provider: provider } });
    const result = await handle(request(value), env, google(uid, {
      providerUserInfo: [{ providerId: 'google.com' }, { providerId: 'password' }]
    }));
    assert.equal(result.status, expected, uid + ' via ' + provider);
  }
});
test('owner cannot bypass Google requirement by also appearing in organizer allowlist', async () => {
  const result = await handle(request(token('owner', { firebase: { sign_in_provider: 'password' } })),
    { ...env, ORGANIZER_UIDS: 'owner,invited' }, google('owner'));
  assert.equal(result.status, 403);
});

const liveEnv = { ...env, CHALLONGE_API_KEY: 'private-challonge-key' };
const event = { id:'123',type:'tournament',attributes:{ name:'FSC Fall Bracket #6',url:'fall6',game_name:'Super Smash Bros. Ultimate' } };
const people = ['11','22'].map((id,i)=>({id,type:'participant',attributes:{name:['Alice','Bob'][i]}}));
function match(id,state,p1='11',p2='22',extra={}) {
  return {id,type:'match',attributes:{state,round:1,suggested_play_order:Number(id),
    relationships:{player1:{data:p1?{id:p1}:null},player2:{data:p2?{id:p2}:null}},...extra}};
}
function liveRequest(path, uid='owner') {
  return new Request('https://api.example'+path,{headers:{Authorization:'Bearer '+token(uid),Origin:'https://fsc-smash-elo.web.app'}});
}
function upstream(matchRows, calls=[]) {
  return async (url,options) => {
    calls.push({url,options});
    if(url.includes('identitytoolkit')) return Response.json({users:[{localId:'owner'}]});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'private-challonge-key');
    assert.equal(options.headers['Authorization-Type'],'v1');
    const u=new URL(url);
    assert.equal(u.origin,'https://api.challonge.com');
    if(u.searchParams.get('page')!=='1') return Response.json({data:[]});
    if(u.pathname.endsWith('/tournaments.json')) {
      assert.equal(u.searchParams.get('state'),'underway');
      return Response.json({data:[event,{...event,id:'124',attributes:{...event.attributes,name:'Unrelated'}}]});
    }
    if(u.pathname.endsWith('/123/participants.json')) return Response.json({data:people});
    if(u.pathname.endsWith('/123/matches.json')) return Response.json({data:matchRows});
    throw new Error('Unexpected endpoint');
  };
}
test('active list is authenticated and limited to FSC Smash singles',async()=>{
  const r=await handle(liveRequest('/tournaments'),liveEnv,upstream([]));
  assert.equal(r.status,200);
  assert.deepEqual((await r.json()).tournaments.map(t=>t.id),['123']);
});
test('refresh only returns open resolved matches using numeric IDs, never writes',async()=>{
  const calls=[];
  const r=await handle(liveRequest('/matches?tournament=123'),liveEnv,upstream([
    match('3','open'),match('1','complete'),match('2','pending'),
    match('4','open','11',null),match('5','open','11','22',{timestamps:{underway_at:'date'}})
  ],calls));
  assert.equal(r.status,200);
  const data=await r.json();
  assert.deepEqual(data.matches.map(m=>m.id),['3','5']);
  assert.equal(data.matches[1].state,'underway');
  assert.equal(data.unresolved,1);
  assert.deepEqual(data.matches[0].players.map(p=>p.name),['Alice','Bob']);
  assert(calls.filter(c=>c.url.includes('challonge')).every(c=>c.options.method==='GET'));
});
test('completed sets disappear on next refresh',async()=>{
  for(const [state,count] of [['open',1],['complete',0]]) {
    const r=await handle(liveRequest('/matches?tournament=123'),liveEnv,upstream([match('1',state)]));
    assert.equal((await r.json()).matches.length,count);
  }
});
test('no live data is queried for an unapproved account or wrong provider',async()=>{
  let calls=0;
  const r=await handle(liveRequest('/tournaments','stranger'),liveEnv,async()=>{
    calls++; return Response.json({users:[{localId:'stranger'}]});
  });
  assert.equal(r.status,403); assert.equal(calls,1);
});
test('invalid or inactive tournament cannot be queried',async()=>{
  for(const [id,status] of [['../../secret',400],['999',409]]) {
    const calls=[];
    const r=await handle(liveRequest('/matches?tournament='+encodeURIComponent(id)),liveEnv,upstream([],calls));
    assert.equal(r.status,status);
    assert(!calls.some(c=>/participants|matches.json/.test(c.url)));
  }
});
test('missing Challonge key returns setup message',async()=>{
  assert.equal((await handle(liveRequest('/tournaments'),env,google('owner'))).status,503);
});
test('pagination continues until empty and rejects duplicates and partial overflow',async()=>{
  let pages=0;
  const rows=await collection('tournaments','tournament','key',async()=>{
    pages++; return Response.json({data:pages===1?[event]:[]});
  });
  assert.equal(rows.length,1); assert.equal(pages,2);
  await assert.rejects(()=>collection('tournaments','tournament','key',async()=>Response.json({data:[event]})),/repeated/);
  let n=0;
  await assert.rejects(()=>collection('tournaments','tournament','key',async()=>Response.json({data:[{...event,id:String(++n)}]})),/pagination limit/);
});
test('Challonge errors are sanitized without leaking key or response content',async()=>{
  for(const code of [401,403,429,500]) {
    const r=await handle(liveRequest('/tournaments'),liveEnv,async(url)=>{
      if(url.includes('identitytoolkit')) return Response.json({users:[{localId:'owner'}]});
      return new Response('private-challonge-key sensitive upstream HTML',{status:code});
    });
    assert.equal(r.status,code===429?429:502);
    assert(!(await r.text()).includes('private-challonge-key'));
  }
});
test('resource-level relationships and unknown opponents are handled',()=>{
  const row=match('1','open');
  row.relationships=row.attributes.relationships;delete row.attributes.relationships;
  assert.equal(openMatches([row],people).matches.length,1);
  assert.equal(openMatches([match('2','open','11','99')],people).unresolved,1);
});

test('redirect is diagnosed and never followed',async()=>{
 let calls=0;
 await assert.rejects(()=>collection('tournaments','tournament','key',async(url,options)=>{
   calls++; assert.equal(options.redirect,'manual');
   return new Response(null,{status:302,headers:{Location:'https://other.example'}});
 }),/HTTP 302 redirect/);
 assert.equal(calls,1);
});
test('non-JSON security challenge is identified without returning body',async()=>{
 await assert.rejects(()=>collection('tournaments','tournament','key',async()=>new Response('<html>Just a moment private-secret</html>')),
 error=>error.message.includes('security challenge')&&!error.message.includes('private-secret'));
});
test('connection errors and timeouts produce distinct safe messages',async()=>{
 for(const [name,pattern] of [['TypeError',/No HTTP response/],['TimeoutError',/timed out/]]){
   await assert.rejects(()=>collection('tournaments','tournament','key',async()=>{
     const e=new Error('private-secret');e.name=name;throw e;
   }),e=>pattern.test(e.message)&&!e.message.includes('private-secret'));
 }
});
test('null JSON response is classified as unexpected format',async()=>{
 await assert.rejects(()=>collection('tournaments','tournament','key',async()=>Response.json(null)),/collection format/);
});
test('invalid key characters fail before contacting Challonge',async()=>{
 const r=await handle(liveRequest('/tournaments'),{...liveEnv,CHALLONGE_API_KEY:'bad key'},google('owner'));
 assert.equal(r.status,503);
 assert((await r.json()).error.includes('invalid characters'));
});
