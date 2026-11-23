import { playerAliases } from './player-aliases.js';
import { reportFor } from './game-records.js';

export function eventDraft(data, id) {
  const event = data.tournaments.find(t => t.id === id);
  if (!event) throw new Error('Tournament not found.');
  const names = new Map(data.players.map(p => [p.id, p.name]));
  return {event: structuredClone(event), participants: data.players.filter(p => data.matches.some(m => m.tournament === id && [m.winner,m.loser].includes(p.id))).map(p => p.name),
    matches: data.matches.filter(m => m.tournament === id).map((m,index) => ({id:m.id, order:index+1,
      a:names.get(m.winner), b:names.get(m.loser), scoreA:m.winnerScore, scoreB:m.loserScore,
      games:(reportFor(data,m)?.games || []).map(g => ({stage:g.stage, a:g.characters[m.winner], b:g.characters[m.loser], winner:g.winner===m.winner?0:1}))}))};
}
const requireValue = (value,message) => { if(!value) throw new Error(message); };
export async function previewEdit(base, draft) {
  const result=structuredClone(base), event=structuredClone(draft.event);
  requireValue(typeof event.name==='string' && event.name.trim() && event.name.length<=120,'Enter a tournament name (up to 120 characters).');
  requireValue(!/\b(test|dummy|practice)\b/i.test(event.name) && !event.isTest,'Test tournaments cannot be published to Elo.');
  requireValue(typeof event.started==='string' && Number.isFinite(Date.parse(event.started)),'Choose a tournament date.');
  requireValue(typeof event.id==='string' && typeof event.slug==='string' && /^[a-zA-Z0-9_-]+$/.test(event.slug),'Invalid tournament identity.');
  requireValue(draft.matches.length>0,'Add at least one completed set before publishing.');
  const aliases={...playerAliases,...(base.aliases||{})};
  const players=new Map(base.players.map(p=>[p.name,{...p}]));
  const player=async value=>{
    let name=String(value||'').trim();const visited=new Set();
    while(true){const alias=Object.keys(aliases).find(k=>k.toLowerCase()===name.toLowerCase()&&aliases[k]!==name);if(!alias)break;requireValue(!visited.has(name),'Player alias cycle.');visited.add(name);name=aliases[alias];}
    requireValue(name && name.length<=100,'Enter both player names (up to 100 characters).');
    const existing=[...players.values()].find(p=>p.name.toLowerCase()===name.toLowerCase());if(existing)return existing;
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name));
    const p={id:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''),name};players.set(name,p);return p;
  };
  const sets=[], reports=[], sourceMatches=[], orders=new Set(), ids=new Set();
  for(const m of [...draft.matches].sort((a,b)=>a.order-b.order)){
    requireValue(Number.isInteger(m.order)&&m.order>0&&!orders.has(m.order),'Each set needs a unique, positive order number.');orders.add(m.order);
    requireValue(typeof m.id==='string'&&m.id&&!ids.has(m.id),'Duplicate set identity.');ids.add(m.id);
    const a=await player(m.a),b=await player(m.b);requireValue(a.id!==b.id,'A player cannot play themself.');
    const scores=[Number(m.scoreA),Number(m.scoreB)];
    requireValue(scores.every(x=>Number.isInteger(x)&&x>=0)&&[2,3].includes(Math.max(...scores))&&Math.min(...scores)<Math.max(...scores),'Use a completed best-of-3 or best-of-5 score, such as 2–1 or 3–2.');
    const win=scores[0]>scores[1]?0:1, ps=[a,b];
    const match={id:m.id,tournament:event.id,winner:ps[win].id,loser:ps[1-win].id,winnerScore:scores[win],loserScore:scores[1-win]};sets.push(match);
    sourceMatches.push({id:m.id,order:m.order,winner:ps[win].name,loser:ps[1-win].name,winnerScore:match.winnerScore,loserScore:match.loserScore});
    if(m.games?.length){
      const report={tournament:event.id,match:m.id,status:'confirmed',games:m.games.map((g,i)=>({number:i+1,stage:g.stage?.trim()||'Unknown',winner:ps[g.winner]?.id,characters:{[a.id]:g.a?.trim()||'Unknown',[b.id]:g.b?.trim()||'Unknown'}}))};
      requireValue(reportFor({gameReports:[report]},match),`Game winners for set ${m.order} must match the score, with no games after the set is won.`);reports.push(report);
    }
  }
  const oldIndex=result.tournaments.findIndex(t=>t.id===event.id);
  requireValue(!result.tournaments.some(t=>t.id!==event.id&&t.slug===event.slug),'This tournament already exists. Edit it instead.');
  event.name=event.name.trim();event.sets=sets.length;event.skipped=0;
  if(oldIndex>=0)result.tournaments[oldIndex]=event;
  else {const after=result.tournaments.findIndex(t=>t.slug===event.afterSlug);requireValue(after>=0||!result.tournaments.length,'Choose the preceding tournament.');result.tournaments.splice(after+1,0,event);}
  // Preserve the established event order; game scores never change the Elo delta.
  const byEvent=new Map(result.tournaments.map(t=>[t.id,t.id===event.id?sets:base.matches.filter(m=>m.tournament===t.id)]));
  result.matches=result.tournaments.flatMap(t=>byEvent.get(t.id));
  const ratings=new Map(), appearances=new Map();
  const allById=new Map([...players.values()].map(p=>[p.id,p]));
  for(const m of result.matches){
    for(const id of [m.winner,m.loser]){requireValue(allById.has(id),'A player is missing.');if(!ratings.has(id)){ratings.set(id,{id,name:allById.get(id).name,elo:1000,wins:0,losses:0});appearances.set(id,new Set())}appearances.get(id).add(m.tournament);}
    const w=ratings.get(m.winner),l=ratings.get(m.loser),delta=Math.floor(64*(1-1/(1+10**((l.elo-w.elo)/400)))+0.5);
    w.elo+=delta;l.elo-=delta;w.wins++;l.losses++;m.change=delta;
  }
  // Preserve appearances not represented by a played set, including byes/DQs.
  const formerAppearances=new Map(base.players.map(p=>[p.id,new Set(base.matches.filter(m=>[m.winner,m.loser].includes(p.id)).map(m=>m.tournament))]));
  for(const p of ratings.values()){const old=allById.get(p.id);if(old.tournamentIds){p.tournamentIds=[...new Set([...old.tournamentIds,...appearances.get(p.id)])];p.tournamentCount=p.tournamentIds.length}else p.tournamentCount=appearances.get(p.id).size+Math.max(0,(old.tournamentCount||0)-(formerAppearances.get(p.id)?.size||0));}
  for(const old of base.players)if(!ratings.has(old.id))ratings.set(old.id,{...old,elo:1000,wins:0,losses:0});
  result.players=[...ratings.values()].sort((a,b)=>b.elo-a.elo||(a.name<b.name?-1:a.name>b.name?1:0));
  result.gameReports=[...(base.gameReports||[]).filter(r=>r.tournament!==event.id),...reports];
  result.revision=crypto.randomUUID();result.updatedAt=new Date().toISOString();
  const source={event:{...event, organizerOrder:result.tournaments.map(t=>t.slug)},participants:[...new Set([...(draft.participants||[]),...sourceMatches.flatMap(m=>[m.winner,m.loser])])],matches:sourceMatches,skipped:0,reports};
  requireValue(new TextEncoder().encode(JSON.stringify(result)).length<750000,'The snapshot is too large. Split storage before publishing more data.');
  return {dashboard:result,source};
}

// A repeated opponent pair is a warning, not proof of a duplicate.
export function duplicateWarnings(base, source) {
  const names=new Map(base.players.map(p=>[p.id,p.name.toLowerCase()]));
  const pair=(a,b)=>JSON.stringify([a.toLowerCase(),b.toLowerCase()].sort());
  const prior=new Map(base.matches.filter(m=>m.tournament===source.event.id).map(m=>[m.id,pair(names.get(m.winner)||'',names.get(m.loser)||'')]));
  const groups=new Map();
  for(const m of source.matches){const key=pair(m.winner,m.loser);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);}
  return [...groups.entries()].filter(([key,sets])=>sets.length>1&&sets.some(m=>prior.get(m.id)!==key)).map(([key,sets])=>({
    key,sets,players:[sets[0].winner,sets[0].loser],
    identical:sets.some((m,i)=>sets.slice(i+1).some(n=>m.winner===n.winner&&m.loser===n.loser&&m.winnerScore===n.winnerScore&&m.loserScore===n.loserScore))
  }));
}
