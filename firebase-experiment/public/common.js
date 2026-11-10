import { stockIcons } from './stock-icons.js';

export const $ = id => document.getElementById(id);
export function text(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
export const signed = value => `${value >= 0 ? '+' : '−'}${Math.abs(value)}`;
export const eventDate = value => new Date(value).toLocaleDateString('en-US', {
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

let dashboardPromise;
export function readDashboard() {
  dashboardPromise ||= (async () => {
    // Catch missing configuration in the page's loading handler.
    const [{ initializeApp }, { getFirestore, doc, getDoc }, { firebaseConfig }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js'),
      import('./firebase-config.js')
    ]);
    const snapshot = await getDoc(doc(getFirestore(initializeApp(firebaseConfig)), 'public', 'dashboard'));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (data.schema !== 1 || !Array.isArray(data.players) ||
        !Array.isArray(data.matches) || !Array.isArray(data.tournaments)) throw new Error('Invalid snapshot');
    return data;
  })();
  return dashboardPromise;
}
