import {assertOpen} from './tournament-status.js';

const historical={
  v3fgwg53:[['SMT'],['Thomas'],['Never'],['Alucard'],['MVQ','Pupusa'],['Tanuki','Zander'],['CoveredinRice','Ethanmagoo','Lavolon','Tal_Dave'],['Big Ant','ItsChris457','No?','Photaru'],['Frostmeiser']],
  yt30nf6m:[['Wildogz'],['Louie'],['Thomas'],['Pupusa'],['Ethanmagoo','Never'],['Alucard','Tal_Dave'],['Zander','Tanuki','Lavolon','Photaru'],['Smidiot','ItsChris457','Big Ant','Frostmeiser']]
};
export function recordedPlaces(data,event){
  const places={};let n=1;const byName=new Map(data.players.map(p=>[(p.name||p.id).toLowerCase(),p.id]));
  if(!event.placementsEdited)for(const group of historical[event.slug]||[]){
    for(let name of group){const seen=new Set();while(data.aliases?.[name]&&!seen.has(name)){seen.add(name);name=data.aliases[name]}
      const id=byName.get(name.toLowerCase());if(id)places[id]=Math.min(n,places[id]??n);}
    n+=group.length;
  }
  return {...places,...event.placements};
}
export function entrants(data,event){
  const places=recordedPlaces(data,event),ids=new Set(Object.keys(places));
  for(const m of data.matches)if(m.tournament===event.id){ids.add(m.winner);ids.add(m.loser)}
  return data.players.filter(p=>ids.has(p.id)||p.tournamentIds?.includes(event.id)).sort((a,b)=>(places[a.id]??Infinity)-(places[b.id]??Infinity)||a.name.localeCompare(b.name));
}
export function withPlacements(base,slug,values){
  const event=base.tournaments.find(t=>t.slug===slug);if(!event)throw Error('Tournament not found.');
  const allowed=new Set(entrants(base,event).map(p=>p.id)),places={};
  for(const [id,value] of Object.entries(values)){if(!allowed.has(id))throw Error('Unknown tournament entrant.');
    if(value===''||value==null)continue;const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('Places must be positive whole numbers.');places[id]=n;}
  const changed=structuredClone(base),e=changed.tournaments.find(t=>t.slug===slug);
  e.placements=places;e.placementsEdited=true;changed.updatedAt=new Date().toISOString();changed.revision=crypto.randomUUID();return changed;
}
export async function savePlaces(sdk,db,base,slug,values,uid){
  const next=withPlacements(base,slug,values),revision=next.revision;
  await sdk.runTransaction(db,async tx=>{
    const ref=sdk.doc(db,'public','dashboard'),snap=await tx.get(ref);if(!snap.exists()||snap.data().revision!==base.revision)throw Error('Results changed. Reload the saved tournament before editing placements.');
    await assertOpen(tx,sdk,db,slug);
    tx.set(sdk.doc(db,'organizerBackups',revision),snap.data());
    tx.set(sdk.doc(db,'organizerUndo',revision),{revision,kind:'placements',slug,uid});
    tx.set(sdk.doc(db,'organizerAudit',revision),{uid,action:'placements',note:'Edited final placements for '+slug,previousRevision:base.revision,updatedAt:next.updatedAt});
    tx.set(ref,next);
  });return next;
}
