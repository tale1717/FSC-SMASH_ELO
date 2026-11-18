const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const {fixture}=await import('../cloudflare-worker/room-fixture.mjs');
 const f=fixture(),created=await f.create();await f.create('51');
 const browser=await chromium.launch({headless:true});
 try{
  const pages=[];
  for(let actor=0;actor<2;actor++){
   const context=await browser.newContext();
   await context.route('https://fsc-smash-elo.web.app/**',async route=>{
    const name=new URL(route.request().url()).pathname.slice(1);
    const file=path.join(__dirname,'../public',name);
    if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
    await route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'image/jpeg'});
   });
   await context.route('https://fsc-smash-elo-api.dstalero71.workers.dev/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const response=await f.send(url.pathname+url.search,req.postData()?JSON.parse(req.postData()):null,req.headers().authorization?.replace('Bearer ',''));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
   });
   const page=await context.newPage();pages.push(page);
   await page.goto('https://fsc-smash-elo.web.app/match.html');
   await page.getByRole('button',{name:/Alice vs Bob/}).waitFor();
   assert.equal(await page.locator('.room-choice').count(),2);
   await page.getByRole('button',{name:/Alice vs Bob/}).click();
   await page.waitForURL('**/match.html?room='+created.room.id);
   assert.match(created.codes[actor],/^[0-9]{6}$/);
   await page.locator('#player-code').fill(created.codes[actor]);
   await page.getByRole('button',{name:'Join match',exact:true}).click();
   await page.locator('#your-name').waitFor();
  }
  async function sync(page){await page.reload();await page.locator('#your-name').waitFor();}
  async function choose(page,label,value,button){await sync(page);console.log('Choosing',label,value,'UI:',await page.locator('#controls').innerText());await page.getByLabel(label,{exact:true}).selectOption(value);await page.getByRole('button',{name:button,exact:true}).click();await page.getByText('Saved. Waiting for the other player when needed.',{exact:true}).waitFor();}
  for(let game=1;game<=2;game++){
   for(const page of pages)await choose(page,'Your character','Mario','Confirm character');
   for(const page of pages)await choose(page,'Your choice','Battlefield','Confirm my choice');
   for(const page of pages){await sync(page);assert.equal(await page.locator('#stage-art .stage-check').count(),0);await page.getByRole('button',{name:'Alice won',exact:true}).click();await page.getByText('Saved. Waiting for the other player when needed.',{exact:true}).waitFor();}
  }
  for(const page of pages){await sync(page);assert.equal(await page.getByRole('button',{name:'Confirm my result',exact:true}).count(),1);await page.getByRole('button',{name:'Confirm my result',exact:true}).click();await page.getByText('Saved. Waiting for the other player when needed.',{exact:true}).waitFor();}
  const pending=await(await f.send('/rooms/'+created.room.id)).json();assert.equal(pending.state.phase,'pending');
  const approved=await f.send('/rooms/'+created.room.id,{action:'approve',revision:pending.revision});assert.equal(approved.status,200);
  await sync(pages[0]);await pages[0].getByRole('heading',{name:'TO approved',exact:true}).waitFor();
  await pages[0].setViewportSize({width:390,height:844});
  assert(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('Two separate players completed and confirmed a shared test set; TO approval and locked-stage artwork passed.');
 }finally{await browser.close();f.sqlite.close()}
})().catch(e=>{console.error(e);process.exit(1)});

