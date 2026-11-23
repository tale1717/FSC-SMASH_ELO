import { readDashboard, text } from './common.js';
import { missingDetails } from './game-records.js';

export function createOverview(auth,api){
  const panel=document.createElement('section');panel.id='organizer-overview';panel.hidden=true;
  document.getElementById('results-editor').before(panel);
  panel.append(text('h2','Organizer overview'),text('p','Load saved results and rooms on demand. Filters use the loaded data; no Challonge requests.'));
  const status=text('p','Load the overview to begin.');status.setAttribute('role','status');
  const refresh=text('button','Load / refresh overview');refresh.type='button';
  const counts=text('p',''),roomList=document.createElement('div'),filters=document.createElement('div'),list=document.createElement('div');
  filters.className='editor-fields';
  const tournament=document.createElement('select'),kind=document.createElement('select'),search=document.createElement('input');search.type='search';
  const label=(name,control)=>{const l=text('label',name);control.setAttribute('aria-label',name);l.append(control);return l};
  for(const [id,name] of [['any','Any missing detail'],['report','No valid game report'],['stage','Unknown stages'],['character','Unknown characters'],['all','All saved sets']])kind.add(new Option(name,id));
  filters.append(label('Overview tournament',tournament),label('Missing details',kind),label('Find saved set by player',search));
  panel.append(refresh,status,counts,roomList,filters,list);
  let enabled=false,epoch=0,data=null,rooms=null;
  function render(){
    const missing=data?data.matches.filter(m=>missingDetails(data,m).missing):[];
    counts.textContent=(rooms===null?'Rooms not loaded':rooms.filter(r=>r.state.phase!=='pending').length+' active rooms loaded · '+rooms.filter(r=>r.state.phase==='pending').length+' awaiting TO approval')+' · '+(data?missing.length+' / '+data.matches.length+' saved sets missing details':'Saved results not loaded');
    roomList.replaceChildren();
    if(rooms)for(const room of rooms.filter(r=>r.state.phase==='pending')){const button=text('button','Review result: '+room.state.match.players.map(p=>p.name).join(' vs '));button.type='button';button.addEventListener('click',()=>{window.dispatchEvent(new CustomEvent('edit-room-result',{detail:room}));document.getElementById('results-editor').scrollIntoView({behavior:'smooth'})});roomList.append(button)}
    list.replaceChildren();filters.hidden=!data;if(!data)return;
    const names=new Map(data.players.map(p=>[p.id,p.name])),events=new Map(data.tournaments.map(t=>[t.id,t.name]));let shown=0;
    const numbered=new Map();for(const m of data.matches){const key=m.tournament,n=(numbered.get(key)||0)+1;numbered.set(key,n);const info=missingDetails(data,m),a=names.get(m.winner)||m.winner,b=names.get(m.loser)||m.loser;
      if(tournament.value&&m.tournament!==tournament.value)continue;
      if(![a,b].join(' ').toLowerCase().includes(search.value.trim().toLowerCase()))continue;
      if(kind.value==='any'&&!info.missing||kind.value==='report'&&!info.report||kind.value==='stage'&&!info.stage||kind.value==='character'&&!info.character)continue;
      const card=document.createElement('article');card.className='match-card';
      card.append(text('h3',a+' '+m.winnerScore+'–'+m.loserScore+' '+b),text('p',events.get(m.tournament)+' · Set '+n),text('p',info.labels.join(' · ')||'Game details complete'));
      const edit=text('button','Edit this set');edit.type='button';edit.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('edit-saved-set',{detail:{data,tournament:m.tournament,match:m.id}})));card.append(edit);list.append(card);shown++;
    }
    list.prepend(text('p',shown+' saved sets shown.'));
  }
  function accept(value){data=value;const selected=tournament.value;tournament.replaceChildren(new Option('All tournaments',''));for(const t of data?.tournaments.slice().reverse()||[])tournament.add(new Option(t.name,t.id));tournament.value=[...tournament.options].some(o=>o.value===selected)?selected:'';render()}
  async function load(){if(!enabled||refresh.disabled)return;const current=epoch;refresh.disabled=true;status.textContent='Loading saved overview…';
    const user=auth.currentUser;
    const results=await Promise.allSettled([readDashboard(true),(async()=>{const token=await user.getIdToken();const response=await fetch(api+'/rooms',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok)throw Error(body.error||'Rooms could not load.');if(!Array.isArray(body.rooms))throw Error('Unexpected rooms response.');return body.rooms})()]);
    if(current!==epoch)return;const errors=[];
    if(results[0].status==='fulfilled')accept(results[0].value);else errors.push('Saved results could not refresh.');
    if(results[1].status==='fulfilled')rooms=results[1].value;else errors.push('Rooms could not refresh.');
    render();status.textContent=(errors.length?errors.join(' ')+' Any previous counts are retained.':'Last checked: '+new Date().toLocaleString())+' No Challonge requests.';refresh.disabled=false;
  }
  refresh.addEventListener('click',load);for(const control of [tournament,kind,search])control.addEventListener('input',render);
  window.addEventListener('saved-results-updated',e=>{if(enabled)accept(e.detail)});
  window.addEventListener('organizer-rooms-updated',e=>{if(enabled&&!e.detail.tournament){rooms=e.detail.rooms;render()}});
  window.addEventListener('organizer-room-closed',e=>{if(rooms){rooms=rooms.filter(r=>r.id!==e.detail);render()}});
  return {enable(){enabled=true;panel.hidden=false},reset(){epoch++;enabled=false;panel.hidden=true;data=null;rooms=null;refresh.disabled=false;search.value='';kind.value='any';tournament.replaceChildren();roomList.replaceChildren();list.replaceChildren();counts.textContent='';status.textContent='Load the overview to begin.'}};
}
