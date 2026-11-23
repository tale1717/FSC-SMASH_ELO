import test from 'node:test';
import assert from 'node:assert/strict';
import {eventDraft,previewEdit} from '../public/editor-data.js';
import {csv,exportRows} from '../public/csv.js';
const base={schema:1,revision:'a',players:[{id:'a',name:'Alice',elo:1032,wins:1,losses:0,tournamentCount:1},{id:'b',name:'Bob',elo:968,wins:0,losses:1,tournamentCount:1}],tournaments:[{id:'1',slug:'one',name:'FSC Fall Bracket #1',started:'2026-11-01T12:00:00-05:00'}],matches:[{id:'set1',tournament:'1',winner:'a',loser:'b',winnerScore:2,loserScore:0,change:32}],gameReports:[]};
test('editing detail preserves Elo; correcting outcome replays it',async()=>{let draft=eventDraft(base,'1');let r=await previewEdit(base,draft);assert.deepEqual(r.dashboard.players,base.players);draft.matches[0].scoreA=0;draft.matches[0].scoreB=2;r=await previewEdit(base,draft);assert.equal(r.dashboard.players[0].name,'Bob');assert.equal(r.dashboard.players[0].elo,1032);assert.equal(base.players[0].elo,1032)});
test('rejects mismatched game results, duplicate orders and self matches',async()=>{const draft=eventDraft(base,'1');draft.matches[0].games=[{winner:1},{winner:1}];await assert.rejects(previewEdit(base,draft),/Game winners/);draft.matches[0].games=[];draft.matches.push({...draft.matches[0],id:'another'});await assert.rejects(previewEdit(base,draft),/unique/);draft.matches.pop();draft.matches[0].b='ALICE';await assert.rejects(previewEdit(base,draft),/themself/)});
test('new tournament adds participation and preserves earlier records',async()=>{const draft={event:{id:'manual-new',slug:'manual-new',name:'FSC Fall Bracket #2',started:'2026-11-18T12:00:00-05:00',afterSlug:'one'},matches:[{id:'second',order:1,a:'Bob',b:'Alice',scoreA:2,scoreB:1,games:[]}]};const r=await previewEdit(base,draft);assert.equal(r.dashboard.players[0].tournamentCount,2);assert.deepEqual(r.dashboard.matches[0],base.matches[0]);assert.equal(r.dashboard.matches[1].change,38)});
test('CSV escapes quotes and formulas and supports filtering',()=>{assert.equal(csv([['=1+1','a,"b"','line\nbreak']]),'\uFEFF"\'=1+1","a,""b""","line\nbreak"\r\n');assert.equal(exportRows(base,'sets','missing').length,1);assert.equal(exportRows(base,'official').length,1);assert.equal(exportRows(base,'rankings').length,3)});
test('manual entry resolves known alts before calculating Elo',async()=>{
 const data=structuredClone(base);data.players[0].name='Ethanmagoo';
 const draft=eventDraft(data,'1');draft.matches[0].a='Doc Magoo';
 const r=await previewEdit(data,draft);assert.equal(r.dashboard.players.length,2);assert.equal(r.source.matches[0].winner,'Ethanmagoo');
});

import {duplicateWarnings} from '../public/editor-data.js';
import {prepareUndo,publishUndo} from '../public/editor-history.js';
test('duplicate warnings flag new repeated pairs, allowing acknowledged resets without blocking existing history',async()=>{
 const draft=eventDraft(base,'1');draft.matches.push({...draft.matches[0],id:'reset',order:2});
 const result=await previewEdit(base,draft),warnings=duplicateWarnings(base,result.source);
 assert.equal(warnings.length,1);assert.equal(warnings[0].identical,true);
 assert.equal(duplicateWarnings(result.dashboard,result.source).length,0);
 draft.matches[1].scoreA=0;draft.matches[1].scoreB=2;
 const reset=await previewEdit(base,draft);assert.equal(duplicateWarnings(base,reset.source)[0].identical,false);
 const otherEvent={...result.source,event:{...result.source.event,id:'2'},matches:[result.source.matches[0]]};assert.equal(duplicateWarnings(base,otherEvent).length,0);
});
test('undo restores the latest publication and importer override in one transaction, rejecting stale previews',async()=>{
 const published=structuredClone(base);published.revision='new';published.players[0].elo=999;
 const prior={source:{event:{slug:'one',organizerOrder:['outdated']},matches:[]},updatedBy:'owner'};
 const state={revision:'new',slug:'one',tournament:'1',previousOverride:prior};
 const audit={tournament:'1',previousRevision:'a',note:'Mistake'};
 const plan=prepareUndo(published,audit,base,state);
 const store=new Map([['public/dashboard',published],['organizerAudit/new',audit],['organizerBackups/new',base],['organizerUndo/new',state],['organizerOverrides/one',{source:{event:{slug:'one'}}}]]);
 let commits=0;
 const sdk={doc:(db,...parts)=>parts.join('/'),runTransaction:async(db,fn)=>{const ops=[];await fn({get:async ref=>({exists:()=>store.has(ref),data:()=>structuredClone(store.get(ref))}),set:(r,v)=>ops.push([r,v]),delete:r=>ops.push([r,null])});for(const[r,v]of ops){if(v===null)store.delete(r);else store.set(r,v)}commits++}};
 await publishUndo(sdk,{},plan,'owner','Correct mistake');
 assert.deepEqual(store.get('public/dashboard').players,base.players);
 assert.deepEqual(store.get('organizerOverrides/one').source.event.organizerOrder,['one']);
 assert.equal(store.get('organizerBackups/'+plan.dashboard.revision).revision,'new');
 await assert.rejects(publishUndo(sdk,{},plan,'owner','Again'),/Another publication/);assert.equal(commits,1);
});
test('undo does not offer incomplete legacy backups',()=>{
 assert.throws(()=>prepareUndo(base,null,base,null),/no complete undo/);
});

 test('cloud drafts are private by UID and detect conflicting device saves',async()=>{
  const {saveCloudDraft,listCloudDrafts,loadCloudDraft}=await import('../public/cloud-drafts.js');
  const records=new Map(),snap=k=>({exists:()=>records.has(k),data:()=>structuredClone(records.get(k))});
  const sdk={doc:(_, ...parts)=>parts.join('/'),getDoc:async k=>snap(k),runTransaction:async(_,fn)=>fn({get:async k=>snap(k),set:(k,v)=>records.set(k,structuredClone(v))})};
  const draft={event:{slug:'test-event',name:'Test'},matches:[]};
  const first=await saveCloudDraft(sdk,null,'alice',draft,'r1');
  assert.equal((await listCloudDrafts(sdk,null,'alice')).length,1);
  assert.equal((await listCloudDrafts(sdk,null,'bob')).length,0);
  const secondDevice=await loadCloudDraft(sdk,null,'alice','test-event');assert.equal(secondDevice.version,first);
  await saveCloudDraft(sdk,null,'alice',draft,'r1',first);
  await assert.rejects(saveCloudDraft(sdk,null,'alice',draft,'r1',secondDevice.version),/another device/);
 });
 test('coverage excludes unconfirmed reports and tracks unknown details separately',async()=>{
  const {coverage}=await import('../public/game-records.js');
  const match={id:'1',tournament:'t',winner:'a',loser:'b',winnerScore:2,loserScore:0};
  const games=[1,2].map(number=>({number,winner:'a',stage:number===1?'Unknown':'PS2',characters:{a:'Mario',b:'Unknown'}}));
  const data={matches:[match,{...match,id:'2'}],gameReports:[{tournament:'t',match:'1',status:'confirmed',games}]};
  assert.deepEqual(coverage(data),{sets:2,covered:1,games:2,stages:1,characters:0});
 });

test('missing-detail filters distinguish absent reports from unknown fields',async()=>{
 const {missingDetails}=await import('../public/game-records.js');
 const m={id:'m',tournament:'t',winner:'a',loser:'b',winnerScore:2,loserScore:0};
 const data={gameReports:[]};assert.equal(missingDetails(data,m).report,true);
 const games=[1,2].map(number=>({number,winner:'a',stage:'PS2',characters:{a:'Mario',b:'Cloud'}}));
 data.gameReports=[{match:'m',tournament:'t',status:'confirmed',games}];assert.equal(missingDetails(data,m).missing,false);
 games[1].stage='Unknown';games[0].characters.b='Unknown';
 const result=missingDetails(data,m);assert.equal(result.stage,true);assert.equal(result.character,true);assert.equal(result.report,false);
});
