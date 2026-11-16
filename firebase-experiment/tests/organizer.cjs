const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../public');
(async()=>{
 const server=http.createServer((req,res)=>{
   const name=new URL(req.url,'http://localhost').pathname;
   if(!/^\/[a-zA-Z0-9.-]+$/.test(name)){res.writeHead(404).end();return;}
   const file=path.join(root,name);
   if(!fs.existsSync(file)){res.writeHead(404).end();return;}
   res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
   res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  const page=await browser.newPage();
  let reads=0, fail=false, empty=false, release;
  await page.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const firebaseConfig = {};'}));
  await page.route('https://www.gstatic.com/firebasejs/**',r=>{
    const app='export const initializeApp=()=>({}); export const getApps=()=>[]; export const getApp=()=>({});';
    const auth=`const user={uid:'owner',email:'owner@example.com',getIdToken:async()=> 'test'};
     const auth={currentUser:user};let callback;
     export const getAuth=()=>auth;
     export const setPersistence=async()=>{};export const browserSessionPersistence={};
     export class GoogleAuthProvider{setCustomParameters(){}}
     export const signInWithPopup=async()=>{};export const signInWithEmailAndPassword=async()=>{};
     export const onAuthStateChanged=(a,cb)=>{callback=cb;queueMicrotask(()=>cb(user));};
     export const signOut=async()=>{auth.currentUser=null;callback(null);};`;
    r.fulfill({contentType:'text/javascript',body:r.request().url().endsWith('firebase-app.js')?app:auth});
  });
  await page.route('https://fsc-smash-elo-api.dstalero71.workers.dev/**',async r=>{
    const u=new URL(r.request().url());
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'Authorization'};
    if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers});return;}
    let body;
    if(u.pathname==='/me') body={uid:'owner',role:'owner'};
    else if(u.pathname==='/tournaments') body={tournaments:empty?[]:[{id:'123',name:'FSC Fall Bracket #6'}]};
    else {
      reads++;
      if(fail){await r.fulfill({status:502,headers,json:{error:'Challonge unavailable'}});return;}
      body={tournament:{id:'123',url:'https://challonge.com/fall6'},fetchedAt:'2026-11-16T12:00:00Z',unresolved:0,
       matches:reads===1?[{id:'44',identifier:'A',round:-2,state:'open',players:[{name:'<b>Alice</b>'},{name:'Bob'}]}]:[]};
    }
    await r.fulfill({headers,json:body});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/organizer.html');
  await page.getByText('Owner access confirmed.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load / reload tournaments'}).click();
  await page.getByText('Select a tournament, then refresh matches.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh matches from Challonge'}).click();
  await page.getByText('1 open matches loaded.',{exact:true}).waitFor();
  assert.equal(await page.locator('.match-card h3').textContent(),'<b>Alice</b> vs Bob');
  assert.equal(await page.locator('.match-card b').count(),0);
  assert((await page.locator('.match-card').textContent()).includes('Losers round 2'));
  await page.getByRole('button',{name:'Refresh matches from Challonge'}).click();
  await page.getByText('No playable matches are currently open.',{exact:false}).waitFor();
  assert.equal(await page.locator('.match-card').count(),0);
  fail=true;
  await page.getByRole('button',{name:'Refresh matches from Challonge'}).click();
  await page.getByText('Challonge unavailable',{exact:true}).waitFor();
  assert.equal(await page.locator('#live-updated').textContent(),'');
  empty=true;
  await page.getByRole('button',{name:'Load / reload tournaments'}).click();
  await page.getByText('No in-progress FSC Fall brackets found.',{exact:false}).waitFor();
  assert(await page.locator('#refresh-matches').isDisabled());
  await page.setViewportSize({width:360,height:800});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  assert(await page.locator('#live-panel').isHidden());
  console.log('Organizer dashboard browser checks passed.');
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
