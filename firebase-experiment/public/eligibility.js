export const MIN_TOURNAMENTS = 4;
export function tournamentCount(player) {
  return Number.isInteger(player.tournamentCount) && player.tournamentCount >= 0 ? player.tournamentCount : null;
}
export function isQualified(player) {
  const count = tournamentCount(player);
  return count !== null && count >= MIN_TOURNAMENTS;
}
export function rankedPlayers(players, official = true) {
  return players.filter(player => !official || isQualified(player));
}
export function eligibilityLabel(player) {
  const count = tournamentCount(player);
  return count === null ? 'Attendance awaiting import' : isQualified(player) ? 'Qualified' : `${MIN_TOURNAMENTS - count} more needed`;
}
