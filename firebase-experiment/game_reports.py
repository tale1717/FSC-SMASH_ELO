"""Publish organizer-reviewed game details without changing official results or Elo."""
import json
from pathlib import Path


def attach_reports(dashboard, reports):
    if not isinstance(reports, list):
        raise ValueError('Game reports must be a list')
    matches = {(m['tournament'], m['id']): m for m in dashboard['matches']}
    seen, output = set(), []
    for report in reports:
        if not isinstance(report, dict):
            raise ValueError('Invalid game report')
        key = (report.get('tournament'), report.get('match'))
        if not all(isinstance(value, str) for value in key) or key in seen:
            raise ValueError('Invalid or duplicate game report identity')
        seen.add(key)
        if report.get('status') != 'confirmed':
            continue
        match = matches.get(key)
        if not match:
            continue
        ids = {match['winner'], match['loser']}
        games = report.get('games')
        valid = isinstance(games, list) and len(games) == match['winnerScore'] + match['loserScore']
        wins = {pid: 0 for pid in ids}
        clean = []
        if valid:
            for index, game in enumerate(games):
                if not isinstance(game, dict):
                    valid = False
                    break
                characters = game.get('characters')
                if (type(game.get('number')) is not int or game['number'] != index + 1 or
                    game.get('winner') not in ids or not isinstance(characters, dict) or
                    set(characters) != ids or
                    any(not isinstance(value, str) or not value.strip() or len(value) > 100
                        for value in [game.get('stage'), *characters.values()])):
                    valid = False
                    break
                wins[game['winner']] += 1
                if index < len(games) - 1 and max(wins.values()) >= match['winnerScore']:
                    valid = False
                    break
                clean.append(dict(number=index+1, stage=game['stage'].strip(),
                                  winner=game['winner'], characters={p: characters[p].strip() for p in ids}))
        valid = valid and wins[match['winner']] == match['winnerScore'] and wins[match['loser']] == match['loserScore']
        output.append(dict(tournament=key[0], match=key[1], status='confirmed' if valid else 'needs-review',
                           games=clean if valid else []))
    dashboard['gameReports'] = output
    return dashboard


def load_reports(dashboard):
    reports = json.loads(Path(__file__).with_name('game-reports.json').read_text(encoding='utf-8'))
    notes_path = Path(__file__).with_name('reviewed-games.json')
    if notes_path.exists():
        reports += resolve_reviewed(dashboard, json.loads(notes_path.read_text(encoding='utf-8')))
    return attach_reports(dashboard, reports)


def resolve_reviewed(dashboard, notes):
    # Resolve reviewed notes to real IDs; never invent a match or change its result.
    events = [t for t in dashboard['tournaments'] if t['slug'] == notes['slug']]
    if not events:
        raise ValueError('Reviewed tournament is missing; no data was published')
    if len(events) != 1:
        raise ValueError('Reviewed tournament is ambiguous')
    tid = events[0]['id']
    players = {p['name']: p['id'] for p in dashboard['players']}
    reports = []
    for note in notes['sets']:
        try:
            ids = [players[name] for name in note['players']]
        except KeyError as error:
            raise ValueError('Reviewed player not found: ' + str(error)) from error
        candidates = [m for m in dashboard['matches'] if m['tournament'] == tid
                      and {m['winner'], m['loser']} == set(ids)]
        occurrence = note['occurrence']
        if type(occurrence) is not int or not 1 <= occurrence <= len(candidates):
            raise ValueError('Reviewed set not found: ' + ' vs '.join(note['players']))
        match = candidates[occurrence - 1]
        games = [dict(number=g['number'], stage=g['stage'], winner=ids[g['winner']],
                      characters=dict(zip(ids, g['characters']))) for g in note['games']]
        report = dict(tournament=tid, match=match['id'], status='confirmed', games=games)
        checked = attach_reports({'matches': [match]}, [report])['gameReports'][0]
        if checked['status'] != 'confirmed':
            raise ValueError('Reviewed games disagree with bracket: ' + ' vs '.join(note['players']))
        reports.append(report)
    return reports

