const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

// Synthetic fixtures: never read production Firestore or use project credentials.
const names = ['Ethanmagoo','Wildogz','Thomas','Louie','SMT','Alucard','Never','Nation','SoulArts','VB3','Tanuki','Pupusa'];
const fixture = {
  schema: 1, updatedAt: '2026-11-08T06:02:48Z',
  players: names.map((name, i) => ({ id: `p${i}`, name, elo: 1400-i*20, wins: i===0?3:0, losses: i===0?1:0 })),
  tournaments: [10,2,1].map(n => ({ id: `e${n}`, name: `FSC Fall Bracket #${n}`, started: '2026-11-01T23:30:00Z', slug: `test-${n}`, sets: 1, skipped: 0 })),
  matches: [
    {id:'1',tournament:'e1',winner:'p0',loser:'p1',winnerScore:2,loserScore:0,change:32},
    {id:'2',tournament:'e2',winner:'p1',loser:'p0',winnerScore:3,loserScore:2,change:35},
    {id:'3',tournament:'e10',winner:'p0',loser:'p1',winnerScore:3,loserScore:1,change:31},
    {id:'4',tournament:'e10',winner:'p0',loser:'p3',winnerScore:2,loserScore:1,change:25}
  ]
};

(async () => {
  const root = path.resolve(__dirname, '../public');
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'};
      res.setHeader('Content-Type', mime[path.extname(file)] || 'text/plain');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/firebase-config.js', route => route.fulfill({contentType:'text/javascript',body:'export const firebaseConfig = {};'}));
  await page.route('https://www.gstatic.com/**', route => route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:
    route.request().url().includes('firebase-app.js') ? 'export const initializeApp = () => ({});' :
    `export const getFirestore=()=>({}); export const doc=()=>({}); export const getDoc=async()=>({exists:()=>true,data:()=>(${JSON.stringify(fixture)})});`
  }));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelectorAll('#rankings tr').length === 12);
    assert.equal(await page.locator('#players-count').textContent(), '12');
    assert.equal(await page.locator('#rankings tr').count(),12);
    assert.equal(await page.locator('.stock-icon').count(),12);
    await page.waitForFunction(() => Array.from(document.images).every(img=>img.complete&&img.naturalWidth));
    assert.match(await page.locator('#rankings tr').nth(3).locator('img').getAttribute('src'),/MiiBrawler/);
    // Verify every saved assignment loads, including icons outside the top ten.
    const assets = await page.evaluate(async () => {
      const {stockIcons} = await import('./stock-icons.js');
      return Promise.all(Object.entries(stockIcons).map(([name,icon])=>new Promise(resolve=>{
        const img=new Image();img.onload=()=>resolve({name,ok:img.naturalWidth>0});img.onerror=()=>resolve({name,ok:false});img.src=icon.src;
      })));
    });
    assert.equal(assets.length,39);assert(assets.every(x=>x.ok));
    for (const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.waitForFunction(() => {
        const centers=Array.from(document.querySelectorAll('.stock-icon'),img=>{const r=img.getBoundingClientRect();return r.x+r.width/2;});
        return Math.max(...centers)-Math.min(...centers)<1;
      });
      const geometry = await page.evaluate(() => {
        const rows=Array.from(document.querySelectorAll('#rankings tr'));
        return {overflow:document.documentElement.scrollWidth>innerWidth,rows:rows.map(row=>{
          const number=row.querySelector('.rank-number').getBoundingClientRect(),icon=row.querySelector('img').getBoundingClientRect(),name=row.querySelector('a').getBoundingClientRect();
          return {numberRight:number.right,iconLeft:icon.left,iconRight:icon.right,nameLeft:name.left,height:row.getBoundingClientRect().height};
        })};
      });
      assert.equal(geometry.overflow,false,`Page overflow at ${width}`);
      assert(geometry.rows.every(row=>row.numberRight<=row.iconLeft&&row.iconRight<=row.nameLeft),`Icon overlap at ${width}`);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#search').fill('Pupusa');
    assert.equal(await page.locator('#rankings tr:visible').count(),1);
    assert.equal(await page.locator('#rankings tr:visible .rank-number').textContent(),'12');
    await page.locator('#search').fill('not a player');assert(await page.locator('#empty').isVisible());
    await page.locator('#search').fill('');
    await page.locator('.player-link').first().click();
    await page.waitForSelector('#player-content:visible');
    assert.match(page.url(),/player.html\?id=p0/);
    assert.equal(await page.locator('#player-name').textContent(),'Ethanmagoo');
    assert.deepEqual(await page.locator('#event-history summary strong').allTextContents(),['FSC Fall Bracket #1','FSC Fall Bracket #2','FSC Fall Bracket #10']);
    assert.equal(await page.locator('#event-history tbody tr').count(),4);
    await page.getByRole('tab',{name:'Head-to-Head',exact:true}).click();
    assert(await page.locator('#h2h-panel').isVisible());assert(!(await page.locator('#history-panel').isVisible()));
    const opponent = page.locator('#h2h-rows tr').filter({hasText:'Wildogz'});
    assert.deepEqual(await opponent.locator('td').allTextContents(),['Wildogz','2','1','67%']);
    await opponent.locator('button').click();
    assert.equal(await page.locator('#rival-events tbody tr').count(),3);
    assert.deepEqual(await page.locator('#rival-events summary strong').allTextContents(),['FSC Fall Bracket #1','FSC Fall Bracket #2','FSC Fall Bracket #10']);
    await page.locator('#close-rival').click();assert(!(await page.locator('#rival-details').isVisible()));
    await page.reload();await page.waitForSelector('#player-content:visible');assert(await page.locator('#h2h-panel').isVisible());
    await page.locator('#h2h-tab').focus();await page.keyboard.press('ArrowLeft');assert(await page.locator('#history-panel').isVisible());
    for(const width of [390,320]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.locator('#back-rankings').click();await page.waitForSelector('#rankings tr');
    await page.goto(origin+'/player.html');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Choose'));
    await page.goto(origin+'/player.html?id=missing');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Player not found'));
    await page.goto(origin+'/player.html?id=p11');await page.waitForSelector('#player-content:visible');
    assert.match(await page.locator('#event-history').textContent(),/No completed sets/);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: all 39 icons; double-digit alignment; desktop/mobile geometry; navigation; numerical tournament order; H2H totals, matchups, tabs, reload and empty profiles.');
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
