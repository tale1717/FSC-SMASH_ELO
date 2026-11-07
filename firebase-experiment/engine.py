"""Pure tournament selection and Elo calculation; no credentials or database access."""
import hashlib
import json
import math
import re
from datetime import datetime

SEEDS = ('3gee2mio', 'ezus0cc3', 'knpl9s22', 'yt30nf6m')
PREFIX = 'FSC Fall Bracket'
MAX_DOCUMENT_BYTES = 750_000


def instant(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('Tournament dates must include a timezone')
    return date


def select(events):
    by_slug = {t['url']: t for t in events}
    reference = by_slug.get(SEEDS[-1], {})
    game = reference.get('game_id')
    if not isinstance(game, int) or game <= 0:
        raise ValueError('Reference Ultimate bracket is missing or has no game ID')
    for slug in SEEDS:
        t = by_slug.get(slug, {})
        if t.get('state') != 'complete' or t.get('game_id') != game:
            raise ValueError(f'Initial bracket missing, unfinished, or wrong game: {slug}')
    def started(t):
        return t.get('started_at') or t.get('start_at')
    cutoff = max(instant(started(by_slug[s])) for s in SEEDS)
    selected = {}
    for t in events:
        if t.get('state') != 'complete' or t.get('game_id') != game:
            continue
        seed = t['url'] in SEEDS
        if not seed and not t['name'].startswith(PREFIX):
            continue
        date = started(t)
        if not seed and instant(date) <= cutoff:
            continue
        if t.get('teams') or t.get('group_stages_enabled'):
            raise ValueError('This experiment supports singles, single-stage brackets only')
        selected[str(t['id'])] = dict(id=str(t['id']), slug=t['url'], name=t['name'], started=date)
    return sorted(selected.values(), key=lambda t: (instant(t['started']), int(t['id'])))


def identity(name, aliases):
    name = name.strip()
    visited = set()
    while name in aliases:
        if name in visited:
            raise ValueError('Alias cycle detected')
        visited.add(name)
        name = aliases[name].strip()
    if not name:
        raise ValueError('Empty player name')
    return name


def normalize(event, participants, matches):
    people = {str(p['id']): p['name'].strip() for p in participants}
    if len(set(people.values())) != len(people):
        raise ValueError('Duplicate participant names need review')
    sets = []
    seen = set()
    skipped = 0
    for m in matches:
        if m.get('state') != 'complete' or m.get('winner_id') is None or m.get('loser_id') is None:
            skipped += 1
            continue
        score = str(m.get('scores_csv') or '').strip()
        if not score:
            skipped += 1
            continue
        parsed = re.fullmatch(r'(-?\d+)\s*-\s*(-?\d+)', score)
        if not parsed:
            raise ValueError('Enter set scores like 2-1; unsupported scores need review')
        a, b = map(int, parsed.groups())
        if a < 0 or b < 0 or a == b:
            skipped += 1
            continue
        winner, loser = str(m['winner_id']), str(m['loser_id'])
        expected = str(m['player1_id'] if a > b else m['player2_id'])
        expected_loser = str(m['player2_id'] if a > b else m['player1_id'])
        if winner != expected or loser != expected_loser or winner == loser:
            raise ValueError('Match winner/loser disagrees with score')
        if winner not in people or loser not in people:
            raise ValueError('Match participant is missing')
        mid = str(m['id'])
        if mid in seen:
            raise ValueError('Duplicate match ID')
        seen.add(mid)
        sets.append(dict(id=mid, winner=people[winner], loser=people[loser],
                         winnerScore=max(a,b), loserScore=min(a,b),
                         order=m.get('suggested_play_order') or int(mid)))
    sets.sort(key=lambda m: (m['order'], int(m['id'])))
    if not sets:
        raise ValueError('Completed tournament has no usable sets; review before publication')
    return dict(event=event, participants=list(people.values()), matches=sets, skipped=skipped)


def change(winner_elo, loser_elo, winner_score, loser_score):
    # Same K=64 score-margin policy as the prepared Java draft, with zero-sum rounding.
    k = max(16, math.floor(128 * (winner_score-loser_score)/winner_score + 0.5))
    expected = 1 / (1 + 10 ** ((loser_elo-winner_elo)/400))
    return math.floor(k * (1-expected) + 0.5)


def validate_size(document):
    if len(json.dumps(document, ensure_ascii=False).encode()) > MAX_DOCUMENT_BYTES:
        raise ValueError('Snapshot exceeds experiment size limit; split storage before continuing')


def build(sources, aliases):
    players = {}
    history = []
    events = []
    source_ids = set()
    match_ids = set()
    def player(name):
        name = identity(name, aliases)
        pid = hashlib.sha256(name.encode()).hexdigest()
        if pid not in players:
            players[pid] = dict(id=pid, name=name, elo=1000, wins=0, losses=0)
        return players[pid]
    ordered = sorted(sources, key=lambda s: (instant(s['event']['started']), int(s['event']['id'])))
    for source in ordered:
        event = source['event']
        if event['id'] in source_ids:
            raise ValueError('Duplicate tournament source')
        source_ids.add(event['id'])
        for name in source['participants']:
            player(name)
        for match in source['matches']:
            key = (event['id'], match['id'])
            if key in match_ids:
                raise ValueError('Duplicate match')
            match_ids.add(key)
            w, l = player(match['winner']), player(match['loser'])
            if w['id'] == l['id']:
                raise ValueError('Aliases merge both opponents in a match')
            delta = change(w['elo'], l['elo'], match['winnerScore'], match['loserScore'])
            w['elo'] += delta
            l['elo'] -= delta
            w['wins'] += 1
            l['losses'] += 1
            history.append(dict(id=match['id'], tournament=event['id'], winner=w['id'], loser=l['id'],
                                winnerScore=match['winnerScore'], loserScore=match['loserScore'], change=delta))
        events.append(dict(**event, sets=len(source['matches']), skipped=source['skipped']))
    result = dict(schema=1, players=sorted(players.values(), key=lambda p: (-p['elo'], p['name'])),
                  tournaments=events, matches=history)
    validate_size(result)
    return result
