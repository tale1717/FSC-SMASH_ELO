function finalizedTournament(t){return t?.slug==='v3fgwg53'||t?.url==='v3fgwg53'||(/^FSC\b/i.test(t?.name||'')&&/Bracket.*#\s*6\b/i.test(t.name));}
export function createRoomDashboard(auth,api){
  const panel=document.createElement('section');panel.hidden=true;panel.id='room-panel';
  const title=document.createElement('h2');title.textContent='Shared match rooms';
  const info=document.createElement('p');info.textContent='Create a room on an open set above. Give each player only their own private code. Approved results must still be entered on Challonge.';
  const status=document.createElement('p');status.setAttribute('role','status');
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh rooms / approvals';
  const list=document.createElement('div'),codes=document.createElement('div');panel.append(title,info,refresh,status,codes,list);document.getElementById('live-panel').after(panel);
  let enabled=false,tournament=null,epoch=0,busy=false;
  function el(tag,value){const x=document.createElement(tag);x.textContent=value;return x;}
  async function call(path,body){const user=auth.currentUser;if(!enabled||!user)throw new Error('Sign in again.');const token=await user.getIdToken();const response=await fetch(api+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(35000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Room request failed.');return data;}
  async function run(task){if(!enabled||busy)return;busy=true;refresh.disabled=true;const current=epoch;try{await task(current)}catch(e){if(current===epoch)status.textContent=e.message}finally{busy=false;refresh.disabled=false}}
  function showCodes(id,players,values){codes.replaceChildren();const box=document.createElement('article');box.className='match-card';box.append(el('h3','Private player codes'));
    const link=el('a','Open player match page');link.href='match.html?room='+encodeURIComponent(id);link.target='_blank';link.rel='noopener';box.append(link);
    values.forEach(({player,code})=>{const label=el('label',players[player].name+' — private code');const field=document.createElement('input');field.readOnly=true;field.value=code;field.setAttribute('aria-label',players[player].name+' private code');label.append(field);box.append(label)});
    box.append(el('p','Codes also appear beneath each player in the room card. Reissuing invalidates the old code.'));codes.append(box);
  }
  async function load(current){const data=await call('/rooms'+(tournament?'?tournament='+encodeURIComponent(tournament.id):''));if(current!==epoch)return;data.rooms=data.rooms.filter(r=>r.state.phase!=='approved'&&!finalizedTournament(r.state.tournament)&&(!r.expiresAt||r.expiresAt>Date.now()));list.replaceChildren();status.textContent=data.rooms.length+' shared rooms loaded.';
    for(const room of data.rooms){const s=room.state,card=document.createElement('article');card.className='match-card';card.dataset.room=room.id;card.append(el('h3',s.match.players.map(p=>p.name).join(' vs ')),el('p','Match '+s.match.identifier+' · '+s.phase+' · '+s.wins.join(' – ')+(s.isTest?' · TEST — excluded from Elo':'')));
      const people=document.createElement('div');people.className='room-players';
      s.match.players.forEach((p,i)=>{const block=el('div','');block.append(el('strong',p.name));const label=el('label','Private player code');const field=document.createElement('input');field.readOnly=true;field.value=room.codes?.[i]||'Reset once to display';field.setAttribute('aria-label',p.name+' private code');label.append(field);block.append(label);people.append(block)});card.append(people);
      const link=el('a','Open player page');link.href='match.html?room='+encodeURIComponent(room.id);link.target='_blank';link.rel='noopener';card.append(link);
      for(const r of s.records)card.append(el('p','Game '+r.game+' · '+r.stage+' · '+r.characters.join(' vs ')+' · '+s.match.players[r.winner].name+' won'));
      const actions=document.createElement('div');actions.className='organizer-actions';
      function action(label,body){const b=el('button',label);b.type='button';b.addEventListener('click',()=>run(async current=>{const data=await call('/rooms/'+room.id,{...body,revision:room.revision});if(current!==epoch)return;if(data.code)showCodes(room.id,s.match.players,[data]);await load(current)}));actions.append(b)}
      const edit=el('button','Enter / edit result');edit.type='button';edit.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('edit-room-result',{detail:room})));actions.append(edit);
      if(s.phase==='pending')action('Approve final result',{action:'approve'});
      if(['review','pending'].includes(s.phase))action('Correct final game',{action:'correct'});
      if(s.phase!=='approved')for(const player of [0,1])action('Reissue '+s.match.players[player].name+' code',{action:'reissue',player});
      if(s.phase==='approved')card.append(el('p','TO approved. Enter this score on Challonge, then refresh the open-match list.'));
      card.append(actions);list.append(card);
    }
  }
  const archive=document.createElement('details');archive.append(el('summary','Archived rooms'));
  archive.append(el('p','Approved, expired, and finalized rooms. Search covers loaded pages. These records are read-only.'));
  const archiveStatus=el('p','Open the archive to load saved rooms.');archiveStatus.setAttribute('role','status');
  const search=document.createElement('input');search.type='search';search.placeholder='Player or tournament';search.setAttribute('aria-label','Search loaded archived rooms');
  const archiveList=document.createElement('div'),more=el('button','Load more archived rooms'),reloadArchive=el('button','Refresh archive');more.type=reloadArchive.type='button';more.hidden=true;
  archive.append(search,reloadArchive,archiveStatus,archiveList,more);panel.append(archive);
  let archived=[],archiveLoaded=false,next=null;
  function renderArchive(){const q=search.value.trim().toLowerCase();archiveList.replaceChildren();const visible=archived.filter(r=>[r.state.tournament.name,...r.state.match.players.map(p=>p.name)].join(' ').toLowerCase().includes(q));
    for(const room of visible){const s=room.state,card=document.createElement('details');card.className='match-card';card.append(el('summary',s.match.players.map(p=>p.name).join(' vs ')+' · '+s.wins.join(' – ')),el('p',s.tournament.name+' · Match '+s.match.identifier+' · '+(s.phase==='approved'?'TO approved':s.phase+' — archived')));
      for(const g of s.records)card.append(el('p','Game '+g.game+' · '+g.stage+' · '+g.characters.join(' vs ')+' · '+s.match.players[g.winner].name+' won'));
      if(s.approvedAt)card.append(el('p','Approved '+new Date(s.approvedAt).toLocaleString()));if(s.organizerNote)card.append(el('p',s.organizerNote));archiveList.append(card);
    }archiveStatus.textContent=visible.length+' shown / '+archived.length+' archived rooms loaded.';more.hidden=!next;
  }
  async function loadArchive(current,reset=false){more.disabled=reloadArchive.disabled=true;try{const data=await call('/rooms?archive=1'+(!reset&&next?'&cursor='+encodeURIComponent(next):''));if(current!==epoch)return;archived=reset?data.rooms:[...archived,...data.rooms];next=data.next;archiveLoaded=true;renderArchive()}finally{more.disabled=reloadArchive.disabled=false}}
  archive.addEventListener('toggle',()=>{if(archive.open&&!archiveLoaded)run(c=>loadArchive(c,true))});
  reloadArchive.addEventListener('click',()=>run(c=>loadArchive(c,true)));more.addEventListener('click',()=>run(c=>loadArchive(c)));search.addEventListener('input',renderArchive);
  refresh.addEventListener('click',()=>run(load));
  window.addEventListener('organizer-room-closed',e=>{for(const card of list.children)if(card.dataset.room===e.detail)card.remove();status.textContent=list.children.length+' shared rooms loaded.'});
  return {
    reset(){epoch++;enabled=false;archived=[];archiveLoaded=false;next=null;archive.open=false;archiveList.replaceChildren();search.value='';more.hidden=true;archiveStatus.textContent='Open the archive to load saved rooms.';tournament=null;panel.hidden=true;list.replaceChildren();codes.replaceChildren();status.textContent=''},
    enable(){enabled=true;panel.hidden=false},
    select(event){epoch++;tournament=event;panel.hidden=!enabled;list.replaceChildren();codes.replaceChildren();status.textContent=event?'Refresh rooms to review existing sets.':''},
    addCreate(card,event,match){const actions=document.createElement('div');actions.className='organizer-actions';const label=el('label','Set format'),best=document.createElement('select');best.add(new Option('Best of 3','3'));best.add(new Option('Best of 5','5'));label.append(best);const create=el('button','Create player room');create.type='button';create.addEventListener('click',()=>run(async current=>{create.disabled=true;try{const data=await call('/rooms',{tournament:event.id,match:match.id,bestOf:Number(best.value)});if(current!==epoch)return;showCodes(data.room.id,match.players,data.codes.map((code,player)=>({code,player})));await load(current)}finally{create.disabled=false}}));actions.append(label,create);card.append(actions)}
  };
}


