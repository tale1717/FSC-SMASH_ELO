import { $, text, readDashboard, playerUrl, eventDate } from './common.js';
import { reportFor } from './game-records.js';
async function load() {
  const params = new URLSearchParams(location.search);
  try {
    const data = await readDashboard();
    if (!data) { $('status').textContent = 'No tournaments have been imported yet.'; return; }
    const match = data.matches.find(m => m.tournament === params.get('tournament') && m.id === params.get('match'));
    if (!match) { $('status').textContent = 'Set not found. Return to the rankings to choose a set.'; return; }
    const people = new Map(data.players.map(p => [p.id,p]));
    const ids = [match.winner,match.loser];
    const from = ids.includes(params.get('player')) ? params.get('player') : match.winner;
    $('back-player').href = playerUrl(from) + '#history'; $('back-player').textContent = '← Back to player';
    const name = id => people.get(id)?.name || 'Unknown player';
    const event = data.tournaments.find(e => e.id === match.tournament);
    $('set-event').textContent = event ? `${event.name} · ${eventDate(event.started)}` : 'Tournament';
    $('set-title').textContent = `${name(match.winner)} vs ${name(match.loser)}`;
    document.title = `${$('set-title').textContent} · FSC Smash Elo`;
    $('set-score').textContent = `${name(match.winner)} wins ${match.winnerScore}–${match.loserScore} · Official set result`;
    for (const id of ids) { const a = text('a', `${name(id)}’s profile`); a.href = playerUrl(id); $('set-player-links').append(a); }
    if (event?.slug && /^[a-zA-Z0-9_-]+$/.test(event.slug)) {
      $('set-bracket').href = `https://challonge.com/${encodeURIComponent(event.slug)}`; $('set-bracket').hidden = false;
    }
    const report = reportFor(data,match);
    const exists = (data.gameReports || []).some(r => r.tournament === match.tournament && r.match === match.id);
    $('game-status').textContent = report ? 'Confirmed game details · Games shown in the order played.' : exists ?
      'Game details are awaiting review or no longer match the official result. They are excluded from statistics.' :
      'Game details unavailable. Characters, stages, and game order were not recorded for this set.';
    if (report) for (const game of report.games) {
      $('game-sequence').append(text('span', `Game ${game.number}: ${name(game.winner)} wins`));
      const block = document.createElement('article'); block.className = 'game-record';
      block.append(text('h3', `Game ${game.number} · ${game.stage}`));
      for (const id of ids) block.append(text('p', `${name(id)} · ${game.characters[id]}`));
      const winner = text('strong', `${name(game.winner)} wins`); winner.className = 'set-win'; block.append(winner);
      $('set-games').append(block);
    }
    $('set-content').hidden = false; $('status').textContent = '';
  } catch { $('status').textContent = 'Set details could not load. Check your connection and refresh.'; }
}
load();
