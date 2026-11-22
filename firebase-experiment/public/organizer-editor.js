import { readDashboard, text, cacheDashboard } from './common.js';
import { eventDraft, previewEdit } from './editor-data.js';

export function createEditor(auth,api) {
  const panel=document.createElement('section');panel.hidden=true;panel.id='results-editor';
  panel.append(text('h2','Tournament results editor'),text('p','Enter tournaments and correct sets without Challonge. Preview changes before publishing. Set order affects Elo; game scores do not.'));
  document.getElementById('live-panel').before(panel);
  const status=text('p','Load saved results to begin.');status.setAttribute('role','status');
  const toolbar=document.createElement('div');toolbar.className='organizer-actions';
  const form=document.createElement('div'),preview=document.createElement('div');panel.append(toolbar,status,form,preview);
  let enabled=false,base=null,draft=null,pending=null,busy=false,epoch=0,roomContext=null;
  const label=(name,input)=>{const l=text('label',name);l.append(input);return l};
  function input(value='',type='text'){const i=document.createElement('input');i.type=type;i.value=value;return i}
  function select(options,value){const s=document.createElement('select');for(const [v,t] of options)s.add(new Option(t,v));s.value=value;return s}
  function button(title,action){const b=text('button',title);b.type='button';b.addEventListener('click',()=>run(action));return b}
  function changed(){pending=null;preview.replaceChildren();}
  function field(name,value,onchange,type='text'){const i=input(value,type);i.addEventListener('change',()=>{onchange(i.value);changed()});return label(name,i)}
  async function run(action){if(!enabled||busy)return;busy=true;const current=epoch;try{await action(current)}catch(e){if(current===epoch)status.textContent=e.code==='permission-denied'?'Editing permission is missing. Deploy the Firestore rules; invited editors also need owner approval for result editing.':e.message}finally{busy=false}}
  async function database(){const sdk=await import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js');return {sdk,db:sdk.getFirestore(auth.app)}}
  async function load(current){const data=await readDashboard(true);if(current!==epoch)return;if(!data)throw Error('No published history found.');base=data;draft=null;roomContext=null;changed();render();status.textContent='Saved results loaded. Select a tournament or create one.'}
  toolbar.append(button('Load / refresh saved results',load),button('New manual tournament',()=>{
    if(!base)throw Error('Load saved results first.');roomContext=null;const slug='manual-'+crypto.randomUUID();
    draft={event:{id:slug,slug,name:'FSC Fall Bracket #'+(base.tournaments.length+1),started:'',afterSlug:base.tournaments.at(-1)?.slug||'',datePrecision:'day'},participants:[],matches:[]};changed();render();
  }));
  toolbar.append(button('Restore my saved draft',()=>{const saved=sessionStorage.getItem('fsc-editor:'+auth.currentUser.uid);if(!saved)throw Error('No draft saved in this tab.');if(!base)throw Error('Load saved results first.');draft=JSON.parse(saved);changed();render();status.textContent='Draft restored. Preview before publishing.'}));
  const download=text('a','Download CSV files');download.href='export.html';toolbar.append(download);
  window.addEventListener('edit-room-result',event=>run(async current=>{
    if(!base)await load(current);if(current!==epoch)return;
    const room=event.detail,s=room.state;if(s.isTest)throw Error('Test rooms cannot be published to Elo.');
    const slug=s.tournament.slug||s.tournament.url?.split('/').pop();
    const known=base.tournaments.find(t=>t.slug===slug||t.id===s.tournament.id);
    if(known)draft=eventDraft(base,known.id);
    else {const newSlug=slug||'manual-'+crypto.randomUUID();draft={event:{id:s.tournament.id,slug:newSlug,name:s.tournament.name,started:s.tournament.startsAt||'',afterSlug:base.tournaments.at(-1)?.slug||'',datePrecision:'day'},participants:[],matches:[]};}
    const m={id:s.match.id,order:draft.matches.length+1,a:s.match.players[0].name,b:s.match.players[1].name,scoreA:s.wins[0],scoreB:s.wins[1],games:s.records.map(g=>({stage:g.stage,a:g.characters[0],b:g.characters[1],winner:g.winner}))};
    const index=draft.matches.findIndex(x=>x.id===m.id);if(index>=0){m.order=draft.matches[index].order;draft.matches[index]=m}else draft.matches.push(m);
    roomContext={room,matchId:m.id};changed();render();panel.scrollIntoView({behavior:'smooth'});status.textContent='Room copied into the editor. Complete missing details and date, then preview. Publishing also closes this room.';
  }));
  async function closeEditedRoom(context,source,note){
    const m=source.matches.find(m=>m.id===context.matchId);if(!m)return;
    const names=context.room.state.match.players.map(p=>p.name);
    const token=await auth.currentUser.getIdToken();
    const response=await fetch(api+'/rooms/'+context.room.id,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'organizer-result',revision:context.room.revision,scores:names.map(n=>n===m.winner?m.winnerScore:m.loserScore),records:(draft.matches.find(x=>x.id===context.matchId)?.games||[]).map((g,i)=>({game:i+1,stage:g.stage||'Unknown',characters:[g.a||'Unknown',g.b||'Unknown'],winner:g.winner})),note}),signal:AbortSignal.timeout(15000)});
    const body=await response.json();if(!response.ok)throw Error(body.error||'Room closure failed.');
    window.dispatchEvent(new CustomEvent('organizer-room-closed',{detail:context.room.id}));
  }
  function render(){
    form.replaceChildren();if(!base)return;
    const picker=select([['','Choose a tournament'],...base.tournaments.slice().reverse().map(t=>[t.id,t.name])],draft?.event.id||'');
    picker.addEventListener('change',()=>{if(!picker.value)return;draft=eventDraft(base,picker.value);roomContext=null;changed();render()});form.append(label('Edit saved tournament',picker));
    if(!draft)return;
    const metadata=document.createElement('div');metadata.className='editor-fields';
    metadata.append(field('Tournament name',draft.event.name,v=>draft.event.name=v),field('Tournament date',draft.event.started?.slice(0,10)||'',v=>{draft.event.started=v?v+'T12:00:00-05:00':'';draft.event.datePrecision='day'},'date'));
    if(!base.tournaments.some(t=>t.id===draft.event.id)){
      const after=select(base.tournaments.map(t=>[t.slug,t.name]),draft.event.afterSlug);after.addEventListener('change',()=>{draft.event.afterSlug=after.value;changed()});metadata.append(label('Insert after tournament (Elo order)',after));
    }
    form.append(metadata,text('p','Choose existing player names to avoid accidental duplicate accounts. Leave game details empty if unknown.'));
    const names=document.createElement('datalist');names.id='editor-player-names';for(const p of base.players)names.append(new Option(p.name));form.append(names);
    const cards=document.createElement('div');form.append(cards);
    for(const [index,m] of draft.matches.entries()){
      const card=document.createElement('details');card.className='match-card';card.open=index===draft.matches.length-1;
      card.append(text('summary','Set '+m.order+' · '+(m.a||'Player 1')+' vs '+(m.b||'Player 2')+' · '+m.scoreA+'–'+m.scoreB));
      const fields=document.createElement('div');fields.className='editor-fields';
      fields.append(field('Set order',m.order,v=>m.order=Number(v),'number'));
      for(const key of ['a','b']){const f=field(key==='a'?'Player 1':'Player 2',m[key],v=>m[key]=v);f.querySelector('input').setAttribute('list','editor-player-names');fields.append(f)}
      fields.append(field('Player 1 wins',m.scoreA,v=>m.scoreA=Number(v),'number'),field('Player 2 wins',m.scoreB,v=>m.scoreB=Number(v),'number'));card.append(fields);
      const games=document.createElement('div');
      for(const [i,g] of (m.games||[]).entries()){
        const row=document.createElement('fieldset');row.append(text('legend','Game '+(i+1)));row.className='editor-fields';
        const stageOptions=['Unknown','Pokémon Stadium 2','Small Battlefield','Battlefield','Town and City','Smashville','Final Destination','Kalos Pokémon League','Hollow Bastion'];
        const stage=select(stageOptions.map(s=>[s,s]),g.stage||'Unknown');stage.addEventListener('change',()=>{g.stage=stage.value;changed()});row.append(label('Stage',stage));
        row.append(field('Player 1 character',g.a,v=>g.a=v),field('Player 2 character',g.b,v=>g.b=v));
        const winner=select([['','Unknown'],['0',m.a||'Player 1'],['1',m.b||'Player 2']],g.winner===null?'':String(g.winner));winner.addEventListener('change',()=>{g.winner=winner.value===''?null:Number(winner.value);changed()});row.append(label('Game winner',winner));games.append(row);
      }
      card.append(games,button('Add / resize game details',()=>{const n=Number(m.scoreA)+Number(m.scoreB);if(!Number.isInteger(n)||n<2||n>5)throw Error('Enter the final set score first.');m.games=Array.from({length:n},(_,i)=>m.games?.[i]||{stage:'Unknown',a:'Unknown',b:'Unknown',winner:null});changed();render()}),button('Clear game details',()=>{m.games=[];changed();render()}));
      card.append(button('Remove this set from draft',()=>{draft.matches.splice(index,1);changed();render()}));cards.append(card);
    }
    form.append(button('Add completed set',()=>{draft.matches.push({id:'manual-set-'+crypto.randomUUID(),order:Math.max(0,...draft.matches.map(m=>m.order))+1,a:'',b:'',scoreA:2,scoreB:0,games:[]});changed();render()}));
    form.append(button('Save draft in this tab',()=>{sessionStorage.setItem('fsc-editor:'+auth.currentUser.uid,JSON.stringify(draft));status.textContent='Draft saved in this tab. Nothing published.'}));
    form.append(button('Preview Elo and results',async current=>{
      const result=await previewEdit(base,draft);if(current!==epoch)return;pending=result;preview.replaceChildren(text('h3','Publication preview'),text('p',draft.event.name+' · '+result.source.matches.length+' sets · '+result.source.reports.length+' sets with game details'));
      const old=new Map(base.players.map(p=>[p.id,p]));const table=document.createElement('table');const head=document.createElement('tr');for(const v of ['Player','Current Elo','After edit'])head.append(text('th',v));table.append(head);
      for(const p of result.dashboard.players){if(old.get(p.id)?.elo===p.elo)continue;const row=document.createElement('tr');for(const v of [p.name,old.get(p.id)?.elo??1000,p.elo])row.append(text('td',v));table.append(row)}preview.append(table);
      const reason=input('');preview.append(label('Change note',reason));
      preview.append(button('Publish reviewed results',async current=>{
        if(!pending)throw Error('Preview your changes again.');if(!reason.value.trim())throw Error('Add a short change note.');
        const {sdk,db}=await database(),uid=auth.currentUser.uid,publication=pending,expected=base.revision;
        await sdk.runTransaction(db,async tx=>{
          const ref=sdk.doc(db,'public','dashboard'),snap=await tx.get(ref);
          if(!snap.exists()||snap.data().revision!==expected)throw Error('Results changed on another device. Save your draft, reload saved results, then review again.');
          const rev=publication.dashboard.revision;
          tx.set(sdk.doc(db,'organizerBackups',rev),snap.data());
          tx.set(sdk.doc(db,'organizerOverrides',publication.source.event.slug),{source:publication.source,updatedBy:uid,updatedAt:publication.dashboard.updatedAt});
          tx.set(sdk.doc(db,'organizerAudit',rev),{uid,tournament:publication.source.event.id,note:reason.value.trim().slice(0,500),updatedAt:publication.dashboard.updatedAt,previousRevision:expected||null});
          tx.set(ref,publication.dashboard);
        });
        if(current!==epoch)return;base=publication.dashboard;cacheDashboard(base);pending=null;preview.replaceChildren();render();status.textContent='Published. Rankings and game statistics updated; previous results backed up. No Challonge requests were made.';
        if(roomContext){try{await closeEditedRoom(roomContext,publication.source,reason.value);roomContext=null;status.textContent+=' Room closed.'}catch(e){status.textContent+=' Room not closed: '+e.message+' Refresh rooms before retrying.'}}
      }));status.textContent='Review the preview, then publish when correct.';
    }));
  }
  const access=document.createElement('details');access.hidden=true;access.append(text('summary','Invite-only editing access'));
  const accessUid=input('');access.append(label('Approved organizer UID',accessUid),text('p','Create their account in Firebase and add their UID to the Worker organizer list first. This grants result-editing access only.'));
  for(const [title,value] of [['Grant editing access',true],['Revoke editing access',false]])access.append(button(title,async()=>{const uid=accessUid.value.trim();if(!/^[a-zA-Z0-9_-]{1,128}$/.test(uid))throw Error('Enter a valid Firebase UID.');const {sdk,db}=await database();await sdk.setDoc(sdk.doc(db,'organizerAccess',uid),{enabled:value});status.textContent=value?'Editing access granted.':'Editing access revoked.'}));panel.append(access);
  return {enable(role){enabled=true;panel.hidden=false;access.hidden=role!=='owner'},reset(){epoch++;enabled=false;roomContext=null;base=null;draft=null;pending=null;panel.hidden=true;form.replaceChildren();preview.replaceChildren();status.textContent='Load saved results to begin.'}};
}
