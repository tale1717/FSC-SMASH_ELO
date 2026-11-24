import {recordedPlaces} from './placements.js';
export function eloProgress(data,id){
  let elo=1000;const rows=[],player=data.players.find(p=>p.id===id);
  for(const event of data.tournaments){
    const sets=data.matches.filter(m=>m.tournament===event.id&&(m.winner===id||m.loser===id));
    const place=recordedPlaces(data,event)[id]??null;
    if(!sets.length&&!player?.tournamentIds?.includes(event.id)&&place===null)continue;
    let wins=0,delta=0;for(const m of sets){if(!Number.isFinite(m.change))return [];const won=m.winner===id;wins+=Number(won);delta+=(won?1:-1)*m.change;}
    elo+=delta;rows.push({name:event.name,wins,losses:sets.length-wins,elo,delta,place});
  }return rows;
}
export function showProgress(parent,data,id){
  const rows=eloProgress(data,id),add=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e};
  parent.append(add('h2','Elo progression'));if(!rows.length){parent.append(add('p','No rated history recorded yet.'));return}
  const values=[1000,...rows.map(r=>r.elo)],lo=Math.min(...values)-10,hi=Math.max(...values)+10;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 620 160');svg.style.width='100%';svg.setAttribute('role','img');svg.setAttribute('aria-label','Elo from 1000 to '+values.at(-1)+'. Tournament details follow.');
  const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',values.map((v,i)=>(16+i*588/(values.length-1))+','+(146-(v-lo)*132/(hi-lo))).join(' '));line.setAttribute('stroke','#b6ed80');line.setAttribute('stroke-width','3');line.setAttribute('fill','none');svg.append(line);
  parent.append(svg);const table=document.createElement('table'),head=document.createElement('tr');for(const h of ['Tournament','Sets W–L','Place','Elo'])head.append(add('th',h));table.append(head);for(const r of rows){const tr=document.createElement('tr');for(const v of [r.name,r.wins+'–'+r.losses,r.place??'—',r.elo+' ('+(r.delta>0?'+':'')+r.delta+')'])tr.append(add('td',v));table.append(tr)}parent.append(table,add('p','Starts at 1000. A dash means bracket placement was not recorded.'));
}
