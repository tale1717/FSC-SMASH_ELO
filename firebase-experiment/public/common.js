import { stockIcons } from './stock-icons.js';

export const $ = id => document.getElementById(id);
export function text(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
export const signed = value => `${value >= 0 ? '+' : '−'}${Math.abs(value)}`;
export const eventDate = value => !value ? 'Date not recorded' : new Date(value).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'
});
export const playerUrl = id => `player.html?id=${encodeURIComponent(id)}`;

export function characterIcon(name, className = 'stock-icon') {
  const icon = stockIcons[name];
  if (!icon) return null;
  const image = document.createElement('img');
  image.src = icon.src;
  image.alt = icon.label;
  image.title = icon.label;
  image.className = className;
  image.width = 30;
  image.height = 30;
  image.decoding = 'async';
  image.addEventListener('error', () => { image.hidden = true; }, { once: true });
  return image;
}

export function orderedTournaments(events) {
  const number = event => Number(event.name.match(/#\s*(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return events.slice().sort((a, b) => number(a) - number(b) ||
    new Date(a.started) - new Date(b.started) || a.id.localeCompare(b.id));
}

export function headToHead(matches, playerId) {
  const records = new Map();
  for (const match of matches) {
    if (match.winner !== playerId && match.loser !== playerId) continue;
    const won = match.winner === playerId;
    const id = won ? match.loser : match.winner;
    const record = records.get(id) || { wins: 0, losses: 0 };
    record[won ? 'wins' : 'losses']++;
    records.set(id, record);
  }
  return records;
}

let dashboardPromise, checkedAt;
const DASHBOARD_CACHE = 'fsc-dashboard-v1';
export function cacheDashboard(data) {
  checkedAt=Date.now();dashboardPromise=Promise.resolve(data);
  try { sessionStorage.setItem(DASHBOARD_CACHE,JSON.stringify({saved:Date.now(),data})); } catch {}
}
export function readDashboard(force=false) {
  if(force){dashboardPromise=null;try{sessionStorage.removeItem(DASHBOARD_CACHE)}catch{}}
  if(!dashboardPromise&&!force){try{const cached=JSON.parse(sessionStorage.getItem(DASHBOARD_CACHE));if(cached&&Date.now()-cached.saved<60000&&cached.data?.schema===1){checkedAt=cached.saved;dashboardPromise=Promise.resolve(cached.data)}}catch{}}
  dashboardPromise ||= (async () => {
    // Catch missing configuration in the page's loading handler.
    const [{ initializeApp, getApps, getApp }, { getFirestore, doc, getDoc }, { firebaseConfig }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js'),
      import('./firebase-config.js')
    ]);
    const snapshot = await getDoc(doc(getFirestore(getApps().length?getApp():initializeApp(firebaseConfig)), 'public', 'dashboard'));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (data.schema !== 1 || !Array.isArray(data.players) ||
        !Array.isArray(data.matches) || !Array.isArray(data.tournaments)) throw new Error('Invalid snapshot');
    cacheDashboard(data);
    return data;
  })().catch(error=>{dashboardPromise=null;throw error});
  return dashboardPromise.then(data=>{snapshotControls(data);return data});
}


// Add confirmed manual history only to history/statistics views, never rankings.
export function withReviewedHistory(data) {
  const extra = data?.reviewedHistory;
  if (!extra || extra.schema !== 1) return data;
  const imported = new Set(data.tournaments.map(t => t.slug));
  const events = extra.tournaments.filter(t => !imported.has(t.slug));
  const ids = new Set(events.map(t => t.id));
  const matches = extra.matches.filter(m => ids.has(m.tournament));
  const needed = new Set(matches.flatMap(m => [m.winner, m.loser]));
  const existing = new Set(data.players.map(p => p.id));
  return {...data,
    players: [...data.players, ...extra.players.filter(p => needed.has(p.id) && !existing.has(p.id))],
    tournaments: [...data.tournaments, ...events], matches: [...data.matches, ...matches],
    gameReports: [...(data.gameReports || []), ...extra.gameReports.filter(r => ids.has(r.tournament))]
  };
}


function snapshotControls(data){
  const status=document.getElementById('status');if(!status||document.getElementById('snapshot-controls')||!data)return;
  const controls=document.createElement('div');controls.id='snapshot-controls';
  const info=text('p','Last checked: '+new Date(checkedAt||Date.now()).toLocaleString()+' · Saved data is reused across pages for up to one minute.');
  const button=text('button','Refresh saved data');button.type='button';
  button.addEventListener('click',async()=>{button.disabled=true;try{await readDashboard(true);location.reload()}catch{info.textContent='Could not refresh. Your displayed results are unchanged.';button.disabled=false}});
  controls.append(info,button);status.after(controls);
}
