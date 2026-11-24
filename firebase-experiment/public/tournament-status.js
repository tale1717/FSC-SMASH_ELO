export const legacySlug='v3fgwg53';
export function isFinalized(entries,slug){return Object.hasOwn(entries,slug)?entries[slug]===true:slug===legacySlug}
export async function assertOpen(tx,sdk,db,slug){
  const snap=await tx.get(sdk.doc(db,'public','tournamentStatus'));
  if(isFinalized(snap.exists()?snap.data().events:{},slug))throw Error('This tournament is finalized. Reopen it before changing results.');
}
export async function changeStatus(sdk,db,slug,wasClosed){
  const ref=sdk.doc(db,'public','tournamentStatus');
  await sdk.runTransaction(db,async tx=>{
    const snap=await tx.get(ref),events=snap.exists()?snap.data().events:{};
    if(isFinalized(events,slug)!==wasClosed)throw Error('Tournament status changed. Check its status again.');
    tx.set(ref,{events:{...events,[slug]:!wasClosed}});
  });
}
