export function applyAliases(base,mapping){
  const result=structuredClone(base),byName=new Map(result.players.map(p=>[p.name.toLowerCase(),p]));
  const resolve=name=>{const seen=new Set();while(true){const key=Object.keys(mapping).find(k=>k.toLowerCase()===name.toLowerCase());if(!key)return name;if(seen.has(key.toLowerCase()))throw Error('Alias cycle detected.');seen.add(key.toLowerCase());name=mapping[key];}};
  const ids=new Map(),groups=new Map();
  for(const p of result.players){const target=byName.get(resolve(p.name).toLowerCase());if(!target)throw Error('The main player is missing.');ids.set(p.id,target.id);if(!groups.has(target.id))groups.set(target.id,[]);groups.get(target.id).push(p);}
  const players=[];
  for(const [id,group] of groups){const p=result.players.find(p=>p.id===id),events=new Set();
    for(const member of group){const played=[...new Set(result.matches.filter(m=>[m.winner,m.loser].includes(member.id)).map(m=>m.tournament))];
      const known=member.tournamentIds||played;
      if(group.length>1&&known.length!==(member.tournamentCount??known.length))throw Error('Attendance for '+member.name+' includes unrecorded appearances. Import attendance details before merging this player.');
      for(const event of known)events.add(event);
    }
    players.push({...p,elo:1000,wins:0,losses:0,tournamentCount:group.length>1?events.size:(p.tournamentCount??events.size),...(group.length>1||p.tournamentIds?{tournamentIds:[...events]}:{})});
  }
  const ratings=new Map(players.map(p=>[p.id,p]));
  for(const m of result.matches){m.winner=ids.get(m.winner);m.loser=ids.get(m.loser);if(m.winner===m.loser)throw Error('These tags played each other. Review that set before merging.');const w=ratings.get(m.winner),l=ratings.get(m.loser);const delta=Math.floor(64*(1-1/(1+10**((l.elo-w.elo)/400)))+.5);w.elo+=delta;l.elo-=delta;w.wins++;l.losses++;m.change=delta;}
  for(const r of result.gameReports||[])for(const g of r.games||[]){g.winner=ids.get(g.winner)||g.winner;g.characters=Object.fromEntries(Object.entries(g.characters).map(([id,c])=>[ids.get(id)||id,c]));}
  result.players=players.sort((a,b)=>b.elo-a.elo||(a.name<b.name?-1:a.name>b.name?1:0));result.aliases={...mapping};
  result.revision=crypto.randomUUID();result.updatedAt=new Date().toISOString();
  if(new TextEncoder().encode(JSON.stringify(result)).length>750000)throw Error('Snapshot is too large to publish.');
  return result;
}
export function previewAliasMerge(base,targetId,aliasIds){
  const target=base.players.find(p=>p.id===targetId);if(!target||!aliasIds.length)throw Error('Choose a main player and at least one alternate tag.');
  const mapping={...(base.aliases||{})};
  for(const id of aliasIds){const alt=base.players.find(p=>p.id===id);if(!alt||id===targetId)throw Error('Choose different alternate tags.');mapping[alt.name]=target.name;}
  return applyAliases(base,mapping);
}
export async function publishAliases(sdk,db,base,preview,uid,note){
  if(!note.trim())throw Error('Add a merge note.');
  await sdk.runTransaction(db,async tx=>{const ref=sdk.doc(db,'public','dashboard'),snap=await tx.get(ref);if(!snap.exists()||snap.data().revision!==base.revision)throw Error('Results changed. Reload and preview the merge again.');
    const revision=preview.revision;tx.set(sdk.doc(db,'organizerBackups',revision),snap.data());
    tx.set(sdk.doc(db,'organizerUndo',revision),{revision,kind:'aliases',uid});
    tx.set(sdk.doc(db,'organizerAudit',revision),{uid,action:'aliases',note:note.trim().slice(0,500),previousRevision:base.revision,updatedAt:preview.updatedAt});tx.set(ref,preview);
  });return preview;
}
