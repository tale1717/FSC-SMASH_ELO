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
 const list=await (await f.send('/rooms?tournament=123')).json();assert.equal(list.rooms.length,2);assert(!JSON.stringify(list).includes(rotated.code));
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
