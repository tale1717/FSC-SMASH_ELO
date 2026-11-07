import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
let data;
function showPlayer(player) {
  $('profile').hidden = false;
  $('profile-name').textContent = player.name;
  $('profile-summary').textContent = `${player.elo} Elo · ${player.wins} wins · ${player.losses} losses`;
  const records = new Map();
  const history = data.matches.filter(m => m.winner === player.id || m.loser === player.id);
  for (const match of history) {
    const won = match.winner === player.id;
    const opponent = won ? match.loser : match.winner;
    const entry = records.get(opponent) || {wins:0, losses:0};
    entry[won ? 'wins' : 'losses']++;
    records.set(opponent, entry);
  }
  $('opponents').replaceChildren();
  for (const opponent of data.players.filter(p => records.has(p.id)).sort((a,b) => a.name.localeCompare(b.name))) {
    const record = records.get(opponent.id), row = document.createElement('tr');
    row.append(text('td',opponent.name), text('td',record.wins), text('td',record.losses));
    $('opponents').append(row);
  }
  $('history').replaceChildren();
  for (const match of history.slice().reverse()) {
    const won = match.winner === player.id;
    const opponent = data.players.find(p => p.id === (won ? match.loser : match.winner));
    const event = data.tournaments.find(t => t.id === match.tournament);
    $('history').append(text('li',`${won ? 'W' : 'L'} ${won ? match.winnerScore : match.loserScore}–${won ? match.loserScore : match.winnerScore} vs ${opponent.name} · ${event.name} · ${won ? '+' : '−'}${match.change} Elo`));
  }
  $('profile').focus();
}
function renderPlayers() {
  const query = $('search').value.trim().toLocaleLowerCase();
  $('rankings').replaceChildren();
  data.players.forEach((player, index) => {
    if (!player.name.toLocaleLowerCase().includes(query)) return;
    const row = document.createElement('tr'), name = document.createElement('td');
    const button = text('button',player.name); button.type='button';
    button.addEventListener('click', () => showPlayer(player)); name.append(button);
    row.append(text('td',index+1),name,text('td',player.elo),text('td',`${player.wins}–${player.losses}`));
    $('rankings').append(row);
  });
  $('empty').hidden = $('rankings').children.length > 0;
}
async function load() {
  try {
    const db = getFirestore(initializeApp(firebaseConfig));
    const snapshot = await getDoc(doc(db,'public','dashboard'));
    if (!snapshot.exists()) { $('status').textContent='No tournaments have been imported yet.'; return; }
    data = snapshot.data();
    if (data.schema !== 1 || !Array.isArray(data.players) || !Array.isArray(data.matches) || !Array.isArray(data.tournaments)) throw new Error('Invalid snapshot');
    $('status').textContent = `Last published: ${new Date(data.updatedAt).toLocaleString()}`;
    $('players-count').textContent=data.players.length;
    $('events-count').textContent=data.tournaments.length;
    $('sets-count').textContent=data.matches.length;
    $('search').disabled=false;
    $('search').addEventListener('input',renderPlayers);
    renderPlayers();
    for (const event of data.tournaments.slice().reverse()) {
      const item = document.createElement('li'), link = text('a',event.name);
      link.href=`https://challonge.com/${encodeURIComponent(event.slug)}`;
      link.target='_blank'; link.rel='noopener noreferrer';
      item.append(link,document.createTextNode(` · ${event.sets} sets · ${new Date(event.started).toLocaleDateString()}`));
      $('tournaments').append(item);
    }
  } catch {
    $('status').textContent='Rankings could not load. Check your connection, Firebase configuration, and published Firestore rules, then refresh.';
  }
}
load();
