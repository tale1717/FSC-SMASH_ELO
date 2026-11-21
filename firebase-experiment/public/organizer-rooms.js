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
    box.append(el('p','Codes are shown here only after creation or reissue. Reissuing invalidates the old code.'));codes.append(box);
  }
  async function load(current){if(!tournament)return;const data=await call('/rooms?tournament='+encodeURIComponent(tournament.id));if(current!==epoch)return;data.rooms=data.rooms.filter(r=>r.state.phase!=='approved'&&!finalizedTournament(r.state.tournament)&&(!r.expiresAt||r.expiresAt>Date.now()));list.replaceChildren();status.textContent=data.rooms.length+' shared rooms loaded.';
    for(const room of data.rooms){const s=room.state,card=document.createElement('article');card.className='match-card';card.append(el('h3',s.match.players.map(p=>p.name).join(' vs ')),el('p','Match '+s.match.identifier+' · '+s.phase+' · '+s.wins.join(' – ')+(s.isTest?' · TEST — excluded from Elo':'')));
      const link=el('a','Open player page');link.href='match.html?room='+encodeURIComponent(room.id);link.target='_blank';link.rel='noopener';card.append(link);
      for(const r of s.records)card.append(el('p','Game '+r.game+' · '+r.stage+' · '+r.characters.join(' vs ')+' · '+s.match.players[r.winner].name+' won'));
      const actions=document.createElement('div');actions.className='organizer-actions';
      function action(label,body){const b=el('button',label);b.type='button';b.addEventListener('click',()=>run(async current=>{const data=await call('/rooms/'+room.id,{...body,revision:room.revision});if(current!==epoch)return;if(data.code)showCodes(room.id,s.match.players,[data]);await load(current)}));actions.append(b)}
      if(s.phase==='pending')action('Approve final result',{action:'approve'});
      if(['review','pending'].includes(s.phase))action('Correct final game',{action:'correct'});
      if(s.phase!=='approved')for(const player of [0,1])action('Reissue '+s.match.players[player].name+' code',{action:'reissue',player});
      if(s.phase==='approved')card.append(el('p','TO approved. Enter this score on Challonge, then refresh the open-match list.'));
      card.append(actions);list.append(card);
    }
  }
  refresh.addEventListener('click',()=>run(load));
  return {
    reset(){epoch++;enabled=false;tournament=null;panel.hidden=true;list.replaceChildren();codes.replaceChildren();status.textContent=''},
    enable(){enabled=true},
    select(event){epoch++;tournament=event;panel.hidden=!event;list.replaceChildren();codes.replaceChildren();status.textContent=event?'Refresh rooms to review existing sets.':''},
    addCreate(card,event,match){const actions=document.createElement('div');actions.className='organizer-actions';const label=el('label','Set format'),best=document.createElement('select');best.add(new Option('Best of 3','3'));best.add(new Option('Best of 5','5'));label.append(best);const create=el('button','Create player room');create.type='button';create.addEventListener('click',()=>run(async current=>{create.disabled=true;try{const data=await call('/rooms',{tournament:event.id,match:match.id,bestOf:Number(best.value)});if(current!==epoch)return;showCodes(data.room.id,match.players,data.codes.map((code,player)=>({code,player})));await load(current)}finally{create.disabled=false}}));actions.append(label,create);card.append(actions)}
  };
}

