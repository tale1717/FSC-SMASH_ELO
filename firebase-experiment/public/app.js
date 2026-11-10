import { $, text, characterIcon, playerUrl, readDashboard, eventDate } from './common.js';

let rows = [];
function alignIcons() {
  if (!rows.length) return;
  const table = $('rankings-table');
  table.querySelector('colgroup')?.remove();
  rows.forEach(row => { row.hidden = false; });
  const widths = Array.from(rows[0].cells, cell => cell.getBoundingClientRect().width);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total) {
    const group = document.createElement('colgroup');
    widths.forEach(width => {
      const col = document.createElement('col');
      col.style.width = `${width / total * 100}%`;
      group.append(col);
    });
    table.prepend(group);
    const numberRight = Math.max(...rows.map(row => row.querySelector('.rank-number').getBoundingClientRect().right));
    const playerLeft = rows[0].querySelector('.player-link').getBoundingClientRect().left;
    const center = (numberRight + playerLeft) / 2;
    rows.forEach(row => {
      const icon = row.querySelector('.stock-icon');
      if (icon) icon.style.left = `${center - row.cells[0].getBoundingClientRect().left}px`;
    });
  }
  const query = $('search').value.trim().toLocaleLowerCase();
  rows.forEach(row => { row.hidden = !row.dataset.name.includes(query); });
  $('empty').hidden = rows.some(row => !row.hidden);
}

async function load() {
  try {
    const data = await readDashboard();
    if (!data) { $('status').textContent = 'No tournaments have been imported yet.'; return; }
    $('status').textContent = `Last published: ${new Date(data.updatedAt).toLocaleString()}`;
    $('players-count').textContent = data.players.length;
    $('events-count').textContent = data.tournaments.length;
    $('sets-count').textContent = data.matches.length;
    const fragment = document.createDocumentFragment();
    rows = data.players.map((player, index) => {
      const row = document.createElement('tr');
      row.dataset.name = player.name.toLocaleLowerCase();
      const rank = document.createElement('td'); rank.className = 'rank-cell';
      const number = text('span', index + 1); number.className = 'rank-number'; rank.append(number);
      const icon = characterIcon(player.name); if (icon) rank.append(icon);
      const name = document.createElement('td'), link = text('a', player.name);
      link.href = playerUrl(player.id); link.className = 'player-link'; name.append(link);
      row.append(rank, name, text('td', player.elo), text('td', `${player.wins}–${player.losses}`));
      fragment.append(row);
      return row;
    });
    $('rankings').replaceChildren(fragment);
    $('search').disabled = false;
    $('search').addEventListener('input', alignIcons);
    alignIcons();
    let previousWidth;
    new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== previousWidth) {
        previousWidth = entry.contentRect.width;
        alignIcons();
      }
    }).observe($('rankings-scroll'));
    for (const event of data.tournaments.slice().reverse()) {
      const item = document.createElement('li'), link = text('a', event.name);
      link.href = `https://challonge.com/${encodeURIComponent(event.slug)}`;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      item.append(link, document.createTextNode(` · ${event.sets} sets · ${eventDate(event.started)}`));
      $('tournaments').append(item);
    }
  } catch {
    $('status').textContent = 'Rankings could not load. Check your connection, Firebase configuration, and published Firestore rules, then refresh.';
  }
}
load();
