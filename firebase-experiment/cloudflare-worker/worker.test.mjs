import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './worker.mjs';
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
