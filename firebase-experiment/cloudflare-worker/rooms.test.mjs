import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './room-fixture.mjs';
import {initialRoom,reduceRoom,STAGES,turnOf} from './worker.mjs';
const initial=()=>initialRoom({id:'123',isTest:true},{id:'50',players:[{name:'Alice'},{name:'Bob'}]},3);
function prepared(){let s=initial();for(const actor of [0,1])s=reduceRoom(s,actor,{action:'join'});for(const actor of [0,1])s=reduceRoom(s,actor,{action:'character',character:'Mario'});return s;}
test('correct player alone can strike; quotas and counterpick restrictions enforced',()=>{
 let s=reduceRoom(prepared(),0,{action:'standard'},()=>0);
 assert.throws(()=>reduceRoom(s,1,{action:'stages',stages:[STAGES[0].name]}),/other player/);
 assert.throws(()=>reduceRoom(s,0,{action:'stages',stages:[STAGES[5].name]}),/required/);
 for(const [actor,ids] of [[0,[0]],[1,[1,2]],[0,[3]]])s=reduceRoom(s,actor,{action:'stages',stages:ids.map(i=>STAGES[i].name)});
 assert.equal(s.stage,STAGES[4].name);assert.equal(s.phase,'result');
 s=reduceRoom(s,0,{action:'winner',winner:0});s=reduceRoom(s,1,{action:'winner',winner:1});assert.equal(s.records.length,0);
 s=reduceRoom(s,1,{action:'winner',winner:0});assert.equal(s.records.length,1);assert.equal(s.game,2);
 for(const actor of [0,1])s=reduceRoom(s,actor,{action:'character',character:'Mario'});
 s=reduceRoom(s,1,{action:'standard'});assert.equal(turnOf(s),0);
 s=reduceRoom(s,0,{action:'stages',stages:STAGES.slice(0,3).map(s=>s.name)});assert.equal(turnOf(s),1);
 s=reduceRoom(s,1,{action:'stages',stages:[STAGES[4].name]});assert.equal(s.phase,'result');
});
test('full set needs both game reports and each own final confirmation',()=>{
 let s=prepared();for(let game=1;game<=2;game++){
 if(game>1)for(const actor of [0,1])s=reduceRoom(s,actor,{action:'character',character:'Cloud'});
 for(const actor of [0,1])s=reduceRoom(s,actor,{action:'agree',stage:'Battlefield'});
 s=reduceRoom(s,0,{action:'winner',winner:0});assert.equal(s.records.length,game-1);
 s=reduceRoom(s,1,{action:'winner',winner:0});
 }
 assert.equal(s.phase,'review');s=reduceRoom(s,0,{action:'confirm',actor:1});assert.deepEqual(s.confirmed,[true,false]);
 assert.throws(()=>reduceRoom(s,0,{action:'confirm'}),/already/);s=reduceRoom(s,1,{action:'confirm'});assert.equal(s.phase,'pending');
});
test('real SQL: code auth, independent rooms, revision collisions and code rotation',async()=>{
 const f=fixture();try{
 const a=await f.create(),b=await f.create('51');assert.notEqual(a.room.id,b.room.id);
 const url='/play/'+a.room.id;
 assert.equal((await f.send(url,null,b.codes[0])).status,403);
 assert.equal((await f.send('/rooms',{tournament:'123',match:'50',bestOf:3})).status,409);
 let r=await f.send(url,null,a.codes[0]),v=await r.json();assert.equal(v.actor,0);assert.equal(v.state.isTest,true);assert.equal(v.code_a,undefined);
 const results=await Promise.all([f.send(url,{action:'join',revision:0},a.codes[0]),f.send(url,{action:'join',revision:0},a.codes[1])]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const latest=await (await f.send('/rooms/'+a.room.id)).json();
 const rotated=await (await f.send('/rooms/'+a.room.id,{action:'reissue',revision:latest.revision,player:0})).json();
 assert.equal((await f.send(url,null,a.codes[0])).status,403);assert.equal((await f.send(url,null,rotated.code)).status,200);
 assert.equal((await f.send('/rooms/'+a.room.id,{action:'approve',revision:latest.revision+1})).status,409);
 const list=await (await f.send('/rooms?tournament=123')).json();assert.equal(list.rooms.length,2);assert.equal(list.rooms.find(r=>r.id===a.room.id).codes[0],rotated.code);
 f.sqlite.prepare('UPDATE match_rooms SET expires_at = 0 WHERE id = ?').run(a.room.id);assert.equal((await f.send(url,null,rotated.code)).status,410);
 }finally{f.sqlite.close()}
});
test('TO approval and correction are authenticated and never write Challonge',async()=>{
 const f=fixture();try{const a=await f.create();let s=prepared();for(let i=0;i<2;i++){if(i)for(const actor of [0,1])s=reduceRoom(s,actor,{action:'character',character:'Mario'});for(const actor of [0,1])s=reduceRoom(s,actor,{action:'agree',stage:'Battlefield'});for(const actor of [0,1])s=reduceRoom(s,actor,{action:'winner',winner:0});}for(const actor of [0,1])s=reduceRoom(s,actor,{action:'confirm'});
 f.sqlite.prepare('UPDATE match_rooms SET state = ? WHERE id = ?').run(JSON.stringify(s),a.room.id);
 assert.equal((await f.send('/rooms/'+a.room.id,{action:'approve',revision:0},a.codes[0])).status,401);
 let corrected=await (await f.send('/rooms/'+a.room.id,{action:'correct',revision:0})).json();assert.equal(corrected.state.phase,'result');assert.deepEqual(corrected.state.confirmed,[false,false]);
 f.sqlite.prepare('UPDATE match_rooms SET state = ? WHERE id = ?').run(JSON.stringify(s),a.room.id);
 const approved=await (await f.send('/rooms/'+a.room.id,{action:'approve',revision:1})).json();assert.equal(approved.state.phase,'approved');assert.equal(approved.state.isTest,true);
 }finally{f.sqlite.close()}
});

test('public lobby exposes only room summaries and six-digit codes stay private',async()=>{
 const f=fixture();try{
  const a=await f.create(),b=await f.create('51');
  for(const code of a.codes)assert.match(code,/^[0-9]{6}$/);
  assert.notEqual(a.codes[0],a.codes[1]);
  const lobby=await(await f.send('/lobby',null,'')).json();
  assert.equal(lobby.rooms.length,2);
  const room=lobby.rooms.find(r=>r.id===a.room.id);
  assert.deepEqual(Object.keys(room).sort(),['bestOf','id','isTest','match','tournament']);
  assert.deepEqual(room.match.players,[{name:'Alice'},{name:'Bob'}]);
  assert(!JSON.stringify(lobby).includes(a.codes[0]));
  assert.equal((await f.send('/lobby',{action:'create'},'')).status,405);
  const row=f.sqlite.prepare('SELECT state FROM match_rooms WHERE id=?').get(a.room.id);
  const state=JSON.parse(row.state);state.phase='review';
  f.sqlite.prepare('UPDATE match_rooms SET state=? WHERE id=?').run(JSON.stringify(state),a.room.id);
  assert.equal((await(await f.send('/lobby',null,'')).json()).rooms.length,2);
  state.phase='approved';f.sqlite.prepare('UPDATE match_rooms SET state=? WHERE id=?').run(JSON.stringify(state),a.room.id);
  f.sqlite.prepare('UPDATE match_rooms SET expires_at=0 WHERE id=?').run(b.room.id);
  assert.equal((await(await f.send('/lobby',null,'')).json()).rooms.length,0);
 }finally{f.sqlite.close()}
});

test('codes persist for organizers but never leak to players or lobby; unchanged polls are small',async()=>{
 const f=fixture();try{const a=await f.create();const list=await(await f.send('/rooms')).json();assert.deepEqual(list.rooms[0].codes,a.codes);
 for(const path of ['/lobby','/play/'+a.room.id]){const body=await(await f.send(path,null,a.codes[0])).json();assert(!JSON.stringify(body).includes(a.codes[1]));assert.equal(body.state?._codes,undefined)}
 const unchanged=await(await f.send('/play/'+a.room.id+'?since=0',null,a.codes[0])).json();assert.deepEqual(unchanged,{unchanged:true,revision:0});
 assert.equal((await f.send('/play/'+a.room.id+'?since=0',null,'abcdef')).status,401);
 }finally{f.sqlite.close()}
});
test('organizer can record an unreported result and it disappears after approval',async()=>{
 const f=fixture();try{const a=await f.create();const url='/rooms/'+a.room.id;
 assert.equal((await f.send(url,{action:'organizer-result',revision:0,scores:[2,0],note:'TO notes'},a.codes[0])).status,401);
 assert.equal((await f.send(url,{action:'organizer-result',revision:0,scores:[2,0],note:'TO notes',records:[{game:1,stage:'Unknown',characters:['Unknown','Unknown'],winner:0}]})).status,400);
 const r=await f.send(url,{action:'organizer-result',revision:0,scores:[2,0],note:'TO notes',records:[]});assert.equal(r.status,200);assert.equal((await r.json()).state.phase,'approved');
 assert.equal((await(await f.send('/rooms')).json()).rooms.length,0);assert.equal((await(await f.send('/lobby')).json()).rooms.length,0);
 }finally{f.sqlite.close()}
});

test('archive is authenticated, excludes active rooms and never exposes codes or calls Challonge',async()=>{
 const f=fixture();try{
 const archived=await f.create(),active=await f.create('51');
 f.sqlite.prepare('UPDATE match_rooms SET expires_at=0 WHERE id=?').run(archived.room.id);
 const {handle}=await import('./worker.mjs');let calls=0;
 const fetcher=async(url)=>{assert.ok(url.includes('identitytoolkit'));calls++;return Response.json({users:[{localId:'owner'}]})};
 const request=path=>new Request('https://api.example'+path,{headers:{Origin:'https://fsc-smash-elo.web.app',Authorization:'Bearer '+f.token}});
 const response=await handle(request('/rooms?archive=1'),f.env,fetcher),data=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.deepEqual(data.rooms.map(r=>r.id),[archived.room.id]);assert.ok(!data.rooms.some(r=>r.id===active.room.id));
 assert.equal(data.rooms[0].codes,undefined);assert.equal(data.rooms[0].state._codes,undefined);assert.equal(data.next,null);
 assert.equal((await handle(request('/rooms?archive=1&cursor='+btoa('null')),f.env,fetcher)).status,400);
 }finally{f.sqlite.close()}
});

test('finalized event blocks player and organizer writes, archives rooms and can reopen',async()=>{
 const f=fixture();try{const {room,codes}=await f.create();f.flags['test-slug']=true;
 assert.equal((await f.send('/play/'+room.id,{action:'join',revision:0},codes[0])).status,410);
 assert.equal((await f.send('/rooms/'+room.id,{action:'reissue',player:0,revision:0})).status,410);
 assert.equal((await(await f.send('/lobby')).json()).rooms.length,0);
 assert.equal((await(await f.send('/rooms?archive=1')).json()).rooms[0].id,room.id);
 f.flags['test-slug']=false;assert.equal((await f.send('/play/'+room.id,{action:'join',revision:0},codes[0])).status,200);
 }finally{f.sqlite.close()}
});
