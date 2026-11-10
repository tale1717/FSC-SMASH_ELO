import { renderStats } from './player-stats.js';
import { setUrl } from './game-records.js';
import { $, text, signed, eventDate, characterIcon, orderedTournaments, headToHead, readDashboard } from './common.js';

const tabs = ['history', 'h2h', 'stats'];
const hashPanel = () => tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'history';
function selectPanel(name, updateUrl = true) {
  for (const key of tabs) {
    $(`${key}-panel`).hidden = key !== name;
    $(`${key}-tab`).setAttribute('aria-selected', String(key === name));
    $(`${key}-tab`).tabIndex = key === name ? 0 : -1;
  }
  if (updateUrl) history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
}
for (const [index, key] of tabs.entries()) {
  $(`${key}-tab`).addEventListener('click', () => selectPanel(key));
  $(`${key}-tab`).addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') target = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (event.key === 'Home') target = tabs[0];
    if (event.key === 'End') target = tabs.at(-1);
    if (!target) return;
    event.preventDefault(); selectPanel(target); $(`${target}-tab`).focus();
  });
}
window.addEventListener('hashchange', () => selectPanel(hashPanel(), false));

function eventBlock(event, matches, player, players, open = false, showOpponent = true) {
  const wins = matches.filter(match => match.winner === player.id).length;
  const delta = matches.reduce((sum, match) => sum + (match.winner === player.id ? match.change : -match.change), 0);
  const details = document.createElement('details'); details.className = 'event-block'; details.open = open;
  const summary = document.createElement('summary'), heading = document.createElement('span');
  heading.className = 'event-heading'; heading.append(text('strong', event.name), text('small', eventDate(event.started)));
  const totals = document.createElement('span'); totals.className = 'event-totals';
  totals.append(text('span', `${wins}–${matches.length - wins}`), text('span', `${signed(delta)} Elo`));
  summary.append(heading, totals); details.append(summary);
  const wrap = document.createElement('div'); wrap.className = 'scroll';
  const table = document.createElement('table'); table.className = 'history-table';
  const head = document.createElement('thead'), labels = document.createElement('tr');
  (showOpponent ? ['Result', 'Opponent', 'Score', 'Elo change', 'Details'] : ['Result', 'Score', 'Elo change', 'Details']).forEach(label => {
    const th = text('th', label); th.scope = 'col'; labels.append(th);
  });
  head.append(labels); table.append(head);
  const body = document.createElement('tbody');
  for (const match of matches) {
    const won = match.winner === player.id, row = document.createElement('tr');
    const result = text('td', won ? 'Win' : 'Loss'); result.className = won ? 'set-win' : 'set-loss'; row.append(result);
    if (showOpponent) row.append(text('td', players.get(won ? match.loser : match.winner)?.name || 'Unknown player'));
    row.append(text('td', won ? `${match.winnerScore}–${match.loserScore}` : `${match.loserScore}–${match.winnerScore}`),
      text('td', signed(won ? match.change : -match.change)));
    const cell = document.createElement('td'), link = text('a', 'View games');
    link.href = setUrl(match, player.id); cell.append(link); row.append(cell);
    body.append(row);
  }
  table.append(body); wrap.append(table); details.append(wrap);
  return details;
}

async function load() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { $('status').textContent = 'Choose a player from the rankings to view their records.'; return; }
  try {
    const data = await readDashboard();
    if (!data) { $('status').textContent = 'No tournaments have been imported yet.'; return; }
    const player = data.players.find(person => person.id === id);
    if (!player) { $('status').textContent = 'Player not found. Their tag may have been merged or changed. Return to rankings to find their current profile.'; return; }
    const players = new Map(data.players.map(person => [person.id, person]));
    const matches = data.matches.filter(match => match.winner === id || match.loser === id);
    const events = orderedTournaments(data.tournaments).reverse()
      .sort((a, b) => (Date.parse(b.started) || 0) - (Date.parse(a.started) || 0))
      .filter(event => matches.some(match => match.tournament === event.id));
    document.title = `${player.name} · FSC Smash Elo`;
    $('player-name').textContent = player.name;
    $('player-rank').textContent = `Rank #${data.players.indexOf(player) + 1} · Fall season`;
    const icon = characterIcon(player.name, 'profile-icon'); if (icon) $('player-icon').append(icon);
    $('player-elo').textContent = player.elo;
    $('player-record').textContent = `${player.wins}–${player.losses}`;
    $('player-events').textContent = events.length;
    events.forEach((event, index) => $('event-history').append(eventBlock(event,
      matches.filter(match => match.tournament === event.id), player, players, index === 0)));
    if (!events.length) $('event-history').append(text('p', 'No completed sets yet.'));
    renderStats(data, player);
    const records = headToHead(matches, id);
    let selectedButton;
    const opponentIds = Array.from(records.keys()).sort((a, b) => (players.get(a)?.name || '').localeCompare(players.get(b)?.name || ''));
    for (const opponentId of opponentIds) {
      const opponent = players.get(opponentId); if (!opponent) continue;
      const record = records.get(opponentId), row = document.createElement('tr'), cell = document.createElement('td');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'opponent-button';
      const holder = document.createElement('span'); holder.className = 'opponent-icon';
      const image = characterIcon(opponent.name, 'character-icon'); if (image) holder.append(image);
      button.append(holder, text('span', opponent.name));
      const winRate = `${Math.round(100 * record.wins / (record.wins + record.losses))}%`;
      button.addEventListener('click', () => {
        selectedButton = button;
        $('rival-title').textContent = `${player.name} vs ${opponent.name}`;
        $('rival-record').textContent = `${record.wins} wins · ${record.losses} losses · ${winRate} win rate`;
        $('rival-events').replaceChildren();
        events.forEach(event => {
          const rivalry = matches.filter(match => match.tournament === event.id && (match.winner === opponentId || match.loser === opponentId));
          if (rivalry.length) $('rival-events').append(eventBlock(event, rivalry, player, players, true, false));
        });
        $('rival-details').hidden = false;
        $('rival-title').focus({ preventScroll: true });
        $('rival-details').scrollIntoView({ block: 'start' });
      });
      cell.append(button); row.append(cell, text('td', record.wins), text('td', record.losses), text('td', winRate)); $('h2h-rows').append(row);
    }
    $('h2h-empty').hidden = records.size !== 0;
    $('close-rival').addEventListener('click', () => { $('rival-details').hidden = true; selectedButton?.focus(); });
    selectPanel(hashPanel(), false);
    $('player-content').hidden = false;
    $('status').textContent = `Last published: ${new Date(data.updatedAt).toLocaleString()}`;
  } catch {
    $('status').textContent = 'Player records could not load. Check your connection and refresh, or return to rankings.';
  }
}
load();
