"""Apply website alias decisions after rebuilding source history."""
from copy import deepcopy
from engine import change, validate_size


def apply_aliases(base, mapping):
    if not mapping:
        return base
    result = deepcopy(base)
    names = {p['name'].lower(): p for p in result['players']}
    def resolve(name):
        seen = set()
        while True:
            key = next((k for k in mapping if k.lower() == name.lower()), None)
            if key is None:
                return name
            if key.lower() in seen:
                raise ValueError('Alias cycle detected')
            seen.add(key.lower())
            name = mapping[key]
    ids, groups = {}, {}
    for p in result['players']:
        target = names.get(resolve(p['name']).lower())
        if not target:
            raise ValueError('Alias main player missing')
        ids[p['id']] = target['id']
        groups.setdefault(target['id'], []).append(p)
    players = {}
    for pid, group in groups.items():
        p = next(p for p in result['players'] if p['id'] == pid)
        events = set()
        for member in group:
            played = {m['tournament'] for m in result['matches'] if member['id'] in (m['winner'], m['loser'])}
            known = member.get('tournamentIds', played)
            if len(group) > 1 and len(known) != member.get('tournamentCount', len(known)):
                raise ValueError('Unrecorded attendance needs review before alias merge')
            events.update(known)
        players[pid] = dict(p, elo=1000, wins=0, losses=0,
                            tournamentCount=len(events) if len(group) > 1 else p.get('tournamentCount',len(events)))
        if len(group) > 1 or 'tournamentIds' in p:
            players[pid]['tournamentIds'] = sorted(events)
    for m in result['matches']:
        m['winner'],m['loser'] = ids[m['winner']],ids[m['loser']]
        if m['winner'] == m['loser']:
            raise ValueError('Aliases merge both opponents in a match')
        w,l = players[m['winner']],players[m['loser']]
        delta = change(w['elo'],l['elo'])
        w['elo'] += delta
        l['elo'] -= delta
        w['wins'] += 1
        l['losses'] += 1
        m['change'] = delta
    for r in result.get('gameReports',[]):
        for g in r.get('games',[]):
            g['winner'] = ids.get(g['winner'],g['winner'])
            g['characters'] = {ids.get(k,k):v for k,v in g['characters'].items()}
    result['players'] = sorted(players.values(),key=lambda p:(-p['elo'],p['name']))
    result['aliases'] = dict(mapping)
    validate_size(result)
    return result
