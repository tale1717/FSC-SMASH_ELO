import { $, text, readDashboard, withReviewedHistory, playerUrl } from './common.js';
import { setUrl } from './game-records.js';
try {
  const original = await readDashboard(), data = withReviewedHistory(original);
  const matches = data?.matches.filter(m => m.reviewedOnly) || [];
  $('status').textContent = matches.length ? `${matches.length} organizer-confirmed sets · Partial bracket coverage. Elo and attendance are pending the full bracket import. Unknown stages remain labeled Unknown.` : 'No separate reviewed sets. Completed imports are available in player history.';
  const people = new Map((data?.players || []).map(p => [p.id, p.name]));
  for (const match of matches) {
    const card = document.createElement('article'); card.className = 'game-record';
    const event = data.tournaments.find(t => t.id === match.tournament);
    card.append(text('small', `${event.name}${match.occurrence > 1 ? ' · Meeting '+match.occurrence : ''}`));
    card.append(text('h2', `${people.get(match.winner)} ${match.winnerScore}–${match.loserScore} ${people.get(match.loser)}`));
    const links = document.createElement('div'); links.className = 'set-links';
    const games = text('a', 'View games'); games.href = setUrl(match, match.winner); links.append(games);
    for (const id of [match.winner, match.loser]) { const link = text('a', people.get(id)+' profile'); link.href = playerUrl(id); links.append(link); }
    card.append(links); $('reviewed-sets').append(card);
  }
} catch { $('status').textContent = 'Reviewed sets could not load. Please refresh.'; }
