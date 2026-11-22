function finalizedTournament(t){return t?.slug==='v3fgwg53'||t?.url==='v3fgwg53'||(/^FSC\b/i.test(t?.name||'')&&/Bracket.*#\s*6\b/i.test(t.name));}
const API='https://fsc-smash-elo-api.dstalero71.workers.dev';
const $=id=>document.getElementById(id),id=new URL(location.href).searchParams.get('room');
const validId=/^[a-z0-9-]{36}$/.test(id||'');
let code='',view=null,busy=false,timer=null,generation=0,polling=false,idlePolls=0,pollErrors=0;
const selected=new Set();
const storageKey='fsc-room:'+id;
try{code=sessionStorage.getItem(storageKey)||''}catch{}
function text(tag,value,className){const e=document.createElement(tag);e.textContent=value;if(className)e.className=className;return e;}
function button(label,handler,disabled=false){const b=text('button',label);b.type='button';b.disabled=disabled;b.addEventListener('click',handler);return b;}
function select(options,current=''){const s=document.createElement('select');s.append(new Option('Choose…',''));for(const v of options)s.add(new Option(v,v));s.value=current;return s;}
function art(stage,check=false){const span=document.createElement('span');span.className='space';const img=document.createElement('img');img.className='stage-image';img.alt=stage.name;img.src=stage.image;span.append(img);if(check){const tick=document.createElement('span');tick.className='stage-check';tick.setAttribute('aria-hidden','true');span.append(tick)}return span;}
async function request(action){
  const response=await fetch(API+'/play/'+id+(!action&&view?'?since='+view.revision:''),{method:action?'POST':'GET',headers:{Authorization:'Bearer '+code,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify({...action,revision:view.revision})}:{}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(data.state&&finalizedTournament(data.state.tournament)){const e=new Error('This tournament is finalized. View its published results.');e.status=410;throw e}if(!response.ok){const e=new Error(data.error||'Could not load this match.');e.status=response.status;throw e}return data;
}
function apply(data){if(data.unchanged){idlePolls++;return}idlePolls=0;if(view&&view.revision>=data.revision&&view.actor===data.actor)return;view=data;selected.clear();render();}
async function action(input){
  if(busy||!view)return;const current=generation;busy=true;render();
  try{const data=await request(input);if(current!==generation)return;apply(data);$('connection').textContent='Saved. Waiting for the other player when needed.'}
  catch(e){if(current!==generation)return;$('connection').textContent=e.message;try{const data=await request();if(current===generation)apply(data)}catch{}}
  finally{if(current===generation){busy=false;render();schedule()}}
}
function schedule(){clearTimeout(timer);if(code&&!document.hidden&&view?.state.phase!=='approved')timer=setTimeout(poll,Math.min(60000,pollErrors?10000*2**pollErrors:view?.state.phase==='pending'?30000:10000+idlePolls*2000))}
async function poll(){if(busy||polling||document.hidden){schedule();return}polling=true;const current=generation;try{const data=await request();if(current!==generation)return;apply(data);pollErrors=0;$('connection').textContent='Connected · Changes sync automatically.'}catch(e){if(current!==generation)return;pollErrors=Math.min(3,pollErrors+1);$('connection').textContent=e.message;if([401,403,410].includes(e.status)){leave(false);return}}finally{polling=false}schedule();}
function leave(clear=true){generation++;clearTimeout(timer);code='';view=null;busy=false;selected.clear();try{sessionStorage.removeItem(storageKey)}catch{}$('join-form').hidden=false;for(const x of ['player-identity','score','controls','st-selection','st-ready','game-history'])$(x).hidden=true;if(clear)$('connection').textContent='Signed out of this match on this device.';}
$('leave-room').addEventListener('click',()=>leave());
$('join-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||!validId)return;busy=true;code=$('player-code').value.trim().toUpperCase();$('connection').textContent='Joining…';try{view=await request();if(!view.state.joined[view.actor])view=await request({action:'join'});try{sessionStorage.setItem(storageKey,code)}catch{}$('player-code').value='';$('connection').textContent='Connected.';render();schedule()}catch(error){leave(false);$('connection').textContent=error.message}finally{busy=false;if(view)render()}});
function render(){
  if(!view)return;const s=view.state,me=view.actor,names=s.match.players.map(p=>p.name);
  $('join-form').hidden=true;$('player-identity').hidden=false;$('your-name').textContent='Playing as '+names[me]+' · Only you can confirm for this player';
  $('match-title').textContent=names.join(' vs ');$('room-label').textContent=s.tournament.name+' · Match '+s.match.identifier+' · Best of '+s.bestOf+(s.isTest?' · TEST — excluded from Elo':' · Results reported manually to the TO');
  $('score').hidden=false;$('score').replaceChildren(text('strong',names[0]),text('span',s.wins.join(' – '),'score'),text('strong',names[1],'right'));
  for(const x of ['controls','st-selection','st-ready'])$(x).hidden=true;
  const controls=$('controls');controls.replaceChildren();
  function panel(title){controls.hidden=false;controls.append(text('h2',title));}
  if(!s.joined[me]){panel('Join this match');controls.append(button('Join as '+names[me],()=>action({action:'join'}),busy));}
  else if(s.phase==='joining'){panel('Waiting for the other player');controls.append(text('p','Both players must join before character selection.'));}
  else if(s.phase==='characters'){
    panel('Game '+s.game+' · Choose your character');const label=text('label','Your character'),choice=select(view.characters,s.characters[me]||'');choice.setAttribute('aria-label',label.textContent);label.append(choice);controls.append(label);
    const confirm=button('Confirm character',()=>action({action:'character',character:choice.value}),busy||!choice.value);choice.addEventListener('change',()=>confirm.disabled=busy||!choice.value);controls.append(confirm);
    if(s.characters[me])controls.append(text('p','Your choice: '+s.characters[me]+'. Waiting for the other player.'));
  }else if(s.phase==='agreement'){
    panel('Agree on a stage?');const label=text('label','Your choice'),choice=select(view.stages.filter(x=>s.game>1||!x.counter).map(x=>x.name),s.choices[me]||'');choice.setAttribute('aria-label',label.textContent);label.append(choice);controls.append(label);
    const agree=button('Confirm my choice',()=>action({action:'agree',stage:choice.value}),busy||!choice.value);choice.addEventListener('change',()=>agree.disabled=busy||!choice.value);controls.append(agree,button('Use stage striking',()=>action({action:'standard'}),busy));
    controls.append(text('p','Other player: '+(s.choices[1-me]||'has not chosen yet')+'. Matching choices lock the stage.'));
  }else if(s.phase==='striking'){renderStages();}
  else if(s.phase==='result'){
    $('st-ready').hidden=false;$('ready-title').textContent='Game '+s.game;$('stage-name').textContent=s.stage;const stage=view.stages.find(x=>x.name===s.stage);const image=art(stage);$('stage-art').replaceChildren(...image.childNodes);
    $('result-status').textContent=s.winnerVotes[me]===null?'Who won this game? Confirm only your own report.':s.winnerVotes[1-me]!==null&&s.winnerVotes[me]!==s.winnerVotes[1-me]?'Reports disagree. Check with your opponent and select the correct winner.':'You reported '+names[s.winnerVotes[me]]+' as winner. Waiting for the other player.';
    $('result-buttons').replaceChildren(...names.map((name,i)=>button(name+' won',()=>action({action:'winner',winner:i}),busy)));
  }else if(s.phase==='review'){
    panel('Review the final set result');controls.append(text('p',names.join(' vs ')+' · '+s.wins.join(' – ')),text('p','Check the game record below before confirming.'));
    controls.append(button(s.confirmed[me]?'You confirmed':'Confirm my result',()=>action({action:'confirm'}),busy||s.confirmed[me]));
    controls.append(text('p',s.confirmed[1-me]?'Opponent confirmed.':'Waiting for opponent confirmation.'));
  }else if(['pending','approved'].includes(s.phase)){
    panel(s.phase==='approved'?'TO approved':'Awaiting TO approval');controls.append(text('p','Please report the score to the TO: '+names[0]+' '+s.wins[0]+' – '+s.wins[1]+' '+names[1]+'.'),text('p',s.isTest?'Test set — no Elo changes.':'The TO must enter the official result on Challonge.'));
  }
  $('game-history').hidden=!s.records.length;$('game-records').replaceChildren(...s.records.map(r=>text('div','Game '+r.game+' · '+r.stage+' · '+r.characters.join(' vs ')+' · '+names[r.winner]+' won','history-item')));
}
function renderStages(){
  const s=view.state,me=view.actor,actor=s.game===1?(s.step===1?1-s.first:s.first):(s.step===0?s.previous:1-s.previous),picking=s.game>1&&s.step===1,quota=s.game===1?[1,2,1][s.step]:(picking?1:3),mine=actor===me;
  $('st-selection').hidden=false;$('st-turn').textContent=s.match.players[actor].name+': '+(picking?'Choose a stage':(s.game===1?'Strike ':'Ban ')+quota+' stage'+(quota>1?'s':''));$('st-instruction').textContent=mine?'Your turn. Select stages, then confirm.':'Waiting for your opponent.';
  const grid=$('st-grid');grid.replaceChildren();for(const counter of [false,true]){if(counter&&s.game===1)continue;const group=document.createElement('section');group.className='stage-group';group.append(text('h3',counter?'Counterpick stages':'Starter stages'));const row=document.createElement('div');row.className='stage-row';
    for(const stage of view.stages.filter(x=>Boolean(x.counter)===counter)){
      const banned=s.banned.includes(stage.name),chosen=selected.has(stage.name);const b=button('',()=>{if(selected.has(stage.name))selected.delete(stage.name);else if(selected.size<quota)selected.add(stage.name);renderStages();const target=[...grid.querySelectorAll('button')].find(x=>x.dataset.stage===stage.name);target?.focus({preventScroll:true})},busy||!mine||banned);
      b.className='tile'+(banned?' banned':chosen?(picking?' picked':' pending-ban'):'');b.dataset.stage=stage.name;b.setAttribute('aria-pressed',String(chosen));const image=art(stage,chosen&&picking);
      if(banned||chosen&&!picking){const cross=document.createElement('span');cross.className='strike-mark';cross.setAttribute('aria-hidden','true');image.append(cross)}
      const state=banned?'Struck':chosen?(picking?'Selected stage':'Strike selected'):picking?'Choose this stage':'Tap to strike';b.setAttribute('aria-label',stage.name+' — '+state);const caption=document.createElement('span');caption.className='stage-caption';caption.append(text('strong',stage.name),text('span',state,'stage-state'));b.append(image,caption);row.append(b);
    }group.append(row);grid.append(group);
  }
  $('stage-progress').textContent=selected.size+' of '+quota+' selected';$('stage-submit').disabled=busy||!mine||selected.size!==quota;$('stage-submit').textContent=picking?'Confirm stage':'Confirm strikes';
}
$('stage-submit').addEventListener('click',()=>action({action:'stages',stages:[...selected]}));
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&code&&!busy)poll()});
let lobbyBusy=false;
async function loadLobby(){
  if(lobbyBusy)return;lobbyBusy=true;$('reload-rooms').disabled=true;$('lobby-status').textContent='Loading available rooms…';
  try{
    const response=await fetch(API+'/lobby',{signal:AbortSignal.timeout(15000)}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not load rooms.');
    if(!Array.isArray(data.rooms))throw new Error('Unexpected room response.');
    data.rooms=data.rooms.filter(r=>!finalizedTournament(r.tournament));
    const list=$('available-rooms');list.replaceChildren();const groups=new Map();
    for(const room of data.rooms){
      if(!/^[a-z0-9-]{36}$/.test(room.id))continue;
      let group=groups.get(room.tournament.id);
      if(!group){group=document.createElement('section');group.className='lobby-group';group.append(text('h3',room.tournament.name));groups.set(room.tournament.id,group);list.append(group)}
      const pick=button('',()=>{location.href='match.html?room='+encodeURIComponent(room.id)});pick.className='room-choice';
      pick.append(text('strong',room.match.players.map(p=>p.name).join(' vs ')),text('small','Match '+room.match.identifier+' · Best of '+room.bestOf+(room.isTest?' · Test — no Elo':'')));group.append(pick);
    }
    $('lobby-status').textContent=data.rooms.length?'Choose the set with your name.':'No player rooms are available yet. Ask the TO to create a room, then refresh.';
  }catch(error){$('available-rooms').replaceChildren();$('lobby-status').textContent=error.message}
  finally{lobbyBusy=false;$('reload-rooms').disabled=false}
}
$('reload-rooms').addEventListener('click',loadLobby);
if(!validId){$('join-form').hidden=true;$('room-picker').hidden=false;$('match-title').textContent='Choose your match';loadLobby();}
else{$('back-to-rooms').hidden=false;if(code)poll();}


