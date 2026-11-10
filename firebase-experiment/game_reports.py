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
    return attach_reports(dashboard, reports)
