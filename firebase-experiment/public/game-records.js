// Only validated, organizer-confirmed game reports contribute to statistics.
export function reportFor(data, match) {
  const reports = (data.gameReports || []).filter(r => r.tournament === match.tournament && r.match === match.id);
  if (reports.length !== 1) return null;
  const report = reports[0], ids = [match.winner, match.loser];
  if (report.status !== 'confirmed' || !Array.isArray(report.games) ||
      report.games.length !== match.winnerScore + match.loserScore) return null;
  const wins = new Map(ids.map(id => [id, 0]));
  for (const [index, game] of report.games.entries()) {
    if (game.number !== index + 1 || !ids.includes(game.winner) ||
        typeof game.stage !== 'string' || !game.stage.trim() || game.stage.length > 100 ||
        !game.characters || ids.some(id => typeof game.characters[id] !== 'string' ||
          !game.characters[id].trim() || game.characters[id].length > 100)) return null;
    wins.set(game.winner, wins.get(game.winner) + 1);
    if (index < report.games.length - 1 && [...wins.values()].some(n => n >= match.winnerScore)) return null;
  }
  return wins.get(match.winner) === match.winnerScore && wins.get(match.loser) === match.loserScore ? report : null;
}
export function playerGames(data, playerId) {
  return data.matches.filter(m => [m.winner, m.loser].includes(playerId)).flatMap(match => {
    const report = reportFor(data, match);
    const opponent = match.winner === playerId ? match.loser : match.winner;
    return report ? report.games.map(game => ({...game, match, opponent,
      character: game.characters[playerId], against: game.characters[opponent], won: game.winner === playerId})) : [];
  });
}
export function aggregateGames(games, key) {
  const rows = new Map();
  for (const game of games) {
    const name = game[key], row = rows.get(name) || {name, wins: 0, losses: 0};
    row[game.won ? 'wins' : 'losses']++; rows.set(name, row);
  }
  return [...rows.values()].sort((a,b) => (b.wins+b.losses)-(a.wins+a.losses) || a.name.localeCompare(b.name));
}
export function setUrl(match, playerId) {
  return `set.html?tournament=${encodeURIComponent(match.tournament)}&match=${encodeURIComponent(match.id)}&player=${encodeURIComponent(playerId)}`;
}
