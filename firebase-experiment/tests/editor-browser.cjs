const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let reads=0;await page.exposeFunction('countRead',()=>{reads++});
  const fixture={schema:1,revision:'old',updatedAt:'2026-11-18T12:00:00Z',players:[{id:'a',name:'Alice',elo:1032,wins:1,losses:0,tournamentCount:1},{id:'b',name:'Bob',elo:968,wins:0,losses:1,tournamentCount:1}],tournaments:[{id:'1',slug:'one',name:'FSC Fall Bracket #1',started:'2026-11-18T12:00:00-05:00'}],matches:[{id:'set1',tournament:'1',winner:'a',loser:'b',winnerScore:2,loserScore:0,change:32}],gameReports:[]};
  await page.route('https://fsc-smash-elo.web.app/**',route=>{
   const name=new URL(route.request().url()).pathname.slice(1);
   if(name==='firebase-config.js')return route.fulfill({contentType:'text/javascript',body:'export const firebaseConfig={};'});
   const file=path.join(__dirname,'../public',name);if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
  });
  await page.route('https://www.gstatic.com/firebasejs/**',route=>{
   const url=route.request().url();let body;
   if(url.endsWith('firebase-app.js'))body='export const initializeApp=()=>({});export const getApps=()=>[];export const getApp=()=>({});';
   else if(url.endsWith('firebase-auth.js'))body=`const user={uid:'owner',email:'owner@example.com',getIdToken:async()=> 'test'};const auth={app:{},currentUser:user};export const getAuth=()=>auth;export const setPersistence=async()=>{};export const browserSessionPersistence={};export class GoogleAuthProvider{setCustomParameters(){}}export const signInWithPopup=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const signOut=async()=>{};export const onAuthStateChanged=(a,cb)=>queueMicrotask(()=>cb(user));`;
   else body=`const store={'public/dashboard':${JSON.stringify(fixture)}};export const getFirestore=()=>({});export const doc=(db,...parts)=>parts.join('/');const snap=ref=>({exists:()=>ref in store,data:()=>structuredClone(store[ref])});export const getDoc=async ref=>{await window.countRead();return snap(ref)};export const runTransaction=async(db,fn)=>{const writes=[];await fn({get:async ref=>snap(ref),set:(ref,value)=>writes.push([ref,value]),delete:ref=>writes.push([ref,null])});window.savedWrites=writes;for(const [ref,value] of writes){if(value===null)delete store[ref];else store[ref]=value}};export const setDoc=async(ref,value)=>{store[ref]=value};`;

   return route.fulfill({contentType:'text/javascript',body});
  });
  await page.route('https://fsc-smash-elo-api.dstalero71.workers.dev/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Authorization'},json:{uid:'owner',role:'owner'}}));
  await page.goto('https://fsc-smash-elo.web.app/organizer.html');
  await page.getByText('Owner access confirmed.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load / refresh saved results'}).click();
  await page.getByText('Saved results loaded. Select a tournament or create one.',{exact:true}).waitFor();
  await page.getByLabel('Edit saved tournament',{exact:true}).selectOption('1');
  await page.getByLabel('Player 1 wins',{exact:true}).fill('0');await page.getByLabel('Player 2 wins',{exact:true}).fill('2');
  await page.getByRole('button',{name:'Preview Elo and results'}).click();
  await page.getByRole('heading',{name:'Publication preview'}).waitFor();
  await page.getByLabel('Change note',{exact:true}).fill('Corrected winner from organizer notes');
  await page.getByRole('button',{name:'Publish reviewed results'}).click();
  await page.getByText('Published. Rankings and game statistics updated;', {exact:false}).waitFor();
  const writes=await page.evaluate(()=>window.savedWrites);assert.equal(writes.length,5);const data=writes.find(([r])=>r==='public/dashboard')[1];assert.equal(data.players[0].name,'Bob');assert.equal(data.players[0].elo,1032);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Preview latest undo',exact:true}).click();
  await page.getByLabel('Undo reason',{exact:true}).fill('Restore the original score');
  await page.getByRole('button',{name:'Restore previous results',exact:true}).click();
  await page.getByText('Previous results restored.',{exact:false}).waitFor();
  const restored=await page.evaluate(()=>window.savedWrites.find(([r])=>r==='public/dashboard')[1]);assert.equal(restored.players[0].name,'Alice');assert.equal(restored.players[0].elo,1032);
  const beforeExport=reads;
  await page.goto('https://fsc-smash-elo.web.app/export.html');await page.getByRole('button',{name:'Download CSV'}).waitFor();
  await page.waitForFunction(()=>!document.getElementById('download-csv').disabled);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();assert.equal((await download).suggestedFilename(),'fsc-smash-rankings.csv');assert.equal(reads,beforeExport);
  console.log('Organizer editor preview, transactional publish, mobile layout and cached CSV export passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
