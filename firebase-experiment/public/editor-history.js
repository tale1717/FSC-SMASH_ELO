export function prepareUndo(current, audit, backup, state) {
  if (!audit || !backup || !state || typeof state.slug !== 'string' || !Object.hasOwn(state,'previousOverride') || state.revision !== current.revision ||
      audit.previousRevision !== backup.revision || audit.tournament !== state.tournament ||
      backup.schema !== 1 || !Array.isArray(backup.players) || !Array.isArray(backup.matches) ||
      !Array.isArray(backup.tournaments)) {
    throw Error('This publication has no complete undo record. Undo is available for edits published after this update.');
  }
  const restored=structuredClone(backup);
  restored.revision=crypto.randomUUID();restored.updatedAt=new Date().toISOString();
  return {expected:current.revision, dashboard:restored, slug:state.slug, tournament:state.tournament,
    previousOverride:state.previousOverride, note:audit.note, originalUpdatedAt:backup.updatedAt};
}

export async function readLatestUndo(sdk, db) {
  const snapshot=await sdk.getDoc(sdk.doc(db,'public','dashboard'));
  if(!snapshot.exists())throw Error('No published results found.');
  const current=snapshot.data(),revision=current.revision;
  const [audit,backup,state]=await Promise.all(['organizerAudit','organizerBackups','organizerUndo'].map(c=>sdk.getDoc(sdk.doc(db,c,revision))));
  return prepareUndo(current,audit.exists()?audit.data():null,backup.exists()?backup.data():null,state.exists()?state.data():null);
}

export async function publishUndo(sdk,db,plan,uid,note) {
  if(!note.trim())throw Error('Add a reason for undoing this publication.');
  await sdk.runTransaction(db,async tx=>{
    const ref=sdk.doc(db,'public','dashboard'),current=await tx.get(ref);
    if(!current.exists()||current.data().revision!==plan.expected)throw Error('Another publication occurred. Preview the latest undo again; nothing was restored.');
    const stateRef=sdk.doc(db,'organizerUndo',plan.expected),state=await tx.get(stateRef);
    if(!state.exists())throw Error('Undo record is missing.');
    const backup=await tx.get(sdk.doc(db,'organizerBackups',plan.expected));
    const audit=await tx.get(sdk.doc(db,'organizerAudit',plan.expected));
    // Rebuild from saved records inside the transaction, not a browser-supplied snapshot.
    const checked=prepareUndo(current.data(),audit.exists()?audit.data():null,backup.exists()?backup.data():null,state.data());
    const oldOverride=await tx.get(sdk.doc(db,'organizerOverrides',checked.slug));
    const restored={...checked.dashboard,revision:plan.dashboard.revision,updatedAt:plan.dashboard.updatedAt},revision=restored.revision;
    tx.set(sdk.doc(db,'organizerBackups',revision),current.data());
    tx.set(sdk.doc(db,'organizerUndo',revision),{revision,slug:checked.slug,tournament:checked.tournament,previousOverride:oldOverride.exists()?oldOverride.data():null,uid});
    if(checked.previousOverride)tx.set(sdk.doc(db,'organizerOverrides',checked.slug),{...checked.previousOverride,source:{...checked.previousOverride.source,event:{...checked.previousOverride.source.event,organizerOrder:restored.tournaments.map(t=>t.slug)}},updatedBy:uid,updatedAt:restored.updatedAt});
    else tx.delete(sdk.doc(db,'organizerOverrides',checked.slug));
    tx.set(sdk.doc(db,'organizerAudit',revision),{uid,tournament:checked.tournament,note:note.trim().slice(0,500),updatedAt:restored.updatedAt,previousRevision:plan.expected,action:'undo',undoneRevision:plan.expected});
    tx.set(ref,restored);
  });
  return plan.dashboard;
}
