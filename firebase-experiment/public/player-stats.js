import { $, text } from './common.js';
import { playerGames, aggregateGames, reportFor } from './game-records.js';

export function renderStats(data, player) {
  const matches = data.matches.filter(m => [m.winner, m.loser].includes(player.id));
  const games = playerGames(data, player.id);
  const covered = matches.filter(m => reportFor(data, m)).length;
  $('game-coverage').textContent = `${games.length} confirmed games · Game details recorded for ${covered} of ${matches.length} sets`;
  $('stats-empty').hidden = games.length > 0;
  $('game-stat-tables').hidden = games.length === 0;
  const filter = $('character-filter');
  for (const character of [...new Set(games.map(g => g.character))].sort()) {
    const option = text('option', character); option.value = character; filter.append(option);
  }
  filter.disabled = games.length === 0;
  function render() {
    const selected = games.filter(g => !filter.value || g.character === filter.value);
    for (const [target, key] of [['stage-rows','stage'], ['character-rows','against']]) {
      $(target).replaceChildren();
      for (const record of aggregateGames(selected, key)) {
        const total = record.wins + record.losses, rate = Math.round(100 * record.wins / total);
        const row = document.createElement('tr'), name = text('td', record.name);
        name.append(text('small', `${total} games`));
        row.append(name, text('td', `${record.wins}–${record.losses}`), text('td', `${rate}%`));
        $(target).append(row);
      }
    }
    $('filtered-games').textContent = `${selected.length} games · ${filter.value || 'All played characters'}`;
  }
  filter.addEventListener('change', render); render();
}
