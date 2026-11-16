export function createLiveDashboard(auth, api) {
  const $ = id => document.getElementById(id);
  const panel = $('live-panel'), select = $('tournament-select');
  const reload = $('load-tournaments'), refresh = $('refresh-matches');
  const status = $('live-status'), cards = $('live-matches');
  const updated = $('live-updated'), bracket = $('live-bracket');
  let generation = 0, enabled = false, busy = false, controller = null;
  function controls() {
    reload.disabled = !enabled || busy;
    select.disabled = !enabled || busy || select.options.length < 2;
    refresh.disabled = !enabled || busy || !select.value;
  }
  function clearMatches() {
    cards.replaceChildren(); updated.textContent = ''; bracket.hidden = true; bracket.removeAttribute('href');
  }
  function reset() {
    generation++; controller?.abort(); enabled = false; busy = false; panel.hidden = true;
    select.replaceChildren(new Option('Load tournaments to begin', ''));
    clearMatches(); status.textContent = 'Load tournaments to begin.'; controls();
  }
  async function read(path) {
    const user = auth.currentUser;
    if (!enabled || !user) throw new Error('Sign in again to continue.');
    const signal = controller.signal;
    const token = await user.getIdToken();
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    const response = await fetch(api + path, {
      headers: { Authorization: 'Bearer ' + token },
      signal
    });
    if (response.status === 401 || response.status === 403) {
      enabled = false;
      throw new Error('Organizer access could not be verified. Sign out and sign in again.');
    }
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Deploy the updated Worker before loading matches.'); }
    if (!response.ok) throw new Error(data.error || 'Could not load Challonge data.');
    return data;
  }
  async function run(task) {
    if (!enabled || busy) return;
    const current = generation;
    busy = true; controls(); controller = new AbortController();
    const pending = controller;
    const timer = setTimeout(() => pending.abort(), 35000);
    try { await task(current); }
    catch (error) {
      if (current === generation) {
        clearMatches();
        status.textContent = error.name === 'AbortError' ? 'The request timed out. Try refreshing again.' : error.message;
      }
    } finally {
      clearTimeout(timer);
      if (current === generation) { busy = false; controls(); }
    }
  }
  reload.addEventListener('click', () => run(async current => {
    clearMatches();
    select.replaceChildren(new Option('Loading…', ''));
    status.textContent = 'Loading in-progress FSC Fall brackets…';
    const data = await read('/tournaments');
    if (current !== generation) return;
    if (!Array.isArray(data.tournaments)) throw new Error('Unexpected tournament response.');
    select.replaceChildren(new Option('Select a tournament', ''));
    for (const t of data.tournaments) select.add(new Option(t.name, t.id));
    if (data.tournaments.length === 1) select.value = data.tournaments[0].id;
    status.textContent = data.tournaments.length
      ? 'Select a tournament, then refresh matches.'
      : 'No in-progress FSC Fall brackets found. Start the tournament on Challonge, then reload this list.';
  }));
  select.addEventListener('change', () => {
    clearMatches(); status.textContent = 'Refresh to load matches for the selected tournament.'; controls();
  });
  refresh.addEventListener('click', () => run(async current => {
    const id = select.value;
    clearMatches(); status.textContent = 'Reading current matches from Challonge…';
    const data = await read('/matches?tournament=' + encodeURIComponent(id));
    if (current !== generation || id !== select.value) return;
    if (!Array.isArray(data.matches) || data.tournament?.id !== id) throw new Error('Unexpected match response.');
    for (const match of data.matches) {
      const card = document.createElement('article'); card.className = 'match-card';
      const heading = document.createElement('h3');
      heading.textContent = match.players.map(p => p.name).join(' vs ');
      const detail = document.createElement('p');
      const round = match.round === null ? 'Round unavailable' : match.round < 0 ? 'Losers round ' + Math.abs(match.round) : 'Winners round ' + match.round;
      detail.textContent = 'Match ' + match.identifier + ' · ' + round + ' · ' +
        (match.state === 'underway' ? 'In progress' : 'Ready to play');
      const ids = document.createElement('p'); ids.className = 'section-note';
      ids.textContent = 'Challonge match ID: ' + match.id;
      card.append(heading, detail, ids); cards.append(card);
    }
    status.textContent = data.matches.length ? data.matches.length + ' open matches loaded.'
      : 'No playable matches are currently open. Check Challonge, then refresh after scores are entered.';
    if (data.unresolved) status.textContent += ' ' + data.unresolved + ' open matches have unresolved opponents and are not shown.';
    updated.textContent = 'Last refreshed: ' + new Date(data.fetchedAt).toLocaleString();
    if (data.tournament.url?.startsWith('https://challonge.com/')) {
      bracket.href = data.tournament.url; bracket.hidden = false;
    }
  }));
  reset();
  return { reset, enable() { enabled = true; panel.hidden = false; controls(); } };
}
