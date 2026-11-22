export function csv(rows) {
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    let s=String(value??'');
    // Prevent spreadsheet formulas in untrusted names and labels.
    if(/^[\s]*[=+@-]/.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n')+'\r\n';
}
export function exportRows(data, kind, tournament='') {
  const players=new Map(data.players.map(p=>[p.id,p])),events=new Map(data.tournaments.map(t=>[t.id,t]));
  if(kind==='rankings'||kind==='official')return [['Rank','Player','Elo','Sets won','Sets lost','Tournaments','Official eligible'],...data.players.filter(p=>kind!=='official'||p.tournamentCount>=4).map((p,i)=>[i+1,p.name,p.elo,p.wins,p.losses,p.tournamentCount,p.tournamentCount>=4?'Yes':'No'])];
  const matches=data.matches.filter(m=>!tournament||m.tournament===tournament),orders=new Map();
  for(const t of data.tournaments)data.matches.filter(m=>m.tournament===t.id).forEach((m,i)=>orders.set(t.id+'|'+m.id,i+1));
  if(kind==='sets')return [['Tournament','Date','Set order','Match ID','Winner','Loser','Winner games','Loser games','Elo change'],...matches.map(m=>[events.get(m.tournament)?.name,events.get(m.tournament)?.started?.slice(0,10),orders.get(m.tournament+'|'+m.id),m.id,players.get(m.winner)?.name,players.get(m.loser)?.name,m.winnerScore,m.loserScore,m.change])];
  const keys=new Set(matches.map(m=>m.tournament+'|'+m.id));
  return [['Tournament','Set order','Match ID','Game','Stage','Winner','Loser','Winner character','Loser character'],...(data.gameReports||[]).filter(r=>r.status==='confirmed'&&keys.has(r.tournament+'|'+r.match)).flatMap(r=>r.games.map(g=>{
    const loser=Object.keys(g.characters).find(p=>p!==g.winner);return [events.get(r.tournament)?.name,orders.get(r.tournament+'|'+r.match),r.match,g.number,g.stage,players.get(g.winner)?.name,players.get(loser)?.name,g.characters[g.winner],g.characters[loser]];
  }))];
}
