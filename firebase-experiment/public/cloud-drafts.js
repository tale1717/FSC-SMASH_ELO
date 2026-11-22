export async function saveCloudDraft(sdk,db,uid,draft,baseRevision,expected=null){
  const id=draft.event.slug;
  if(!/^[a-zA-Z0-9_-]+$/.test(id)||new TextEncoder().encode(JSON.stringify(draft)).length>650000)throw Error('Invalid or oversized draft.');
  const version=crypto.randomUUID(),updatedAt=new Date().toISOString();
  await sdk.runTransaction(db,async tx=>{
    const ref=sdk.doc(db,'organizerDrafts',uid,'items',id),indexRef=sdk.doc(db,'organizerDraftIndexes',uid);
    const prior=await tx.get(ref),index=await tx.get(indexRef);
    if((prior.exists()?prior.data().version:null)!==expected)throw Error('This cloud draft changed on another device. Save a copy in this tab, then load the cloud draft before replacing it.');
    tx.set(ref,{draft,baseRevision:baseRevision||null,version,updatedAt,uid});
    const items={...(index.exists()?index.data().items:{})};items[id]={name:draft.event.name||'Untitled tournament',updatedAt};
    tx.set(indexRef,{items,uid});
  });return version;
}
export async function listCloudDrafts(sdk,db,uid){
  const index=await sdk.getDoc(sdk.doc(db,'organizerDraftIndexes',uid));
  return Object.entries(index.exists()?index.data().items:{}).map(([id,value])=>({id,...value})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function loadCloudDraft(sdk,db,uid,id){
  const snap=await sdk.getDoc(sdk.doc(db,'organizerDrafts',uid,'items',id));
  if(!snap.exists())throw Error('This draft no longer exists.');return snap.data();
}
