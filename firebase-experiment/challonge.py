"""Challonge v2.1 transport and JSON:API adapters (account API-key auth)."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.challonge.com/v2.1/'
PAGE_SIZE = 25
MAX_PAGES = 50


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an organizer credential to a redirect destination.
        return None


def collection(path, key, kind, **filters):
    if not re.fullmatch(r'tournaments(?:/\d+/(?:participants|matches))?', path):
        raise ValueError('Unsupported Challonge endpoint')
    opener = urllib.request.build_opener(NoRedirect)
    result, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        query = urllib.parse.urlencode(dict(filters, page=page, per_page=PAGE_SIZE))
        req = urllib.request.Request(BASE + path + '.json?' + query, headers={
            'Authorization': key, 'Authorization-Type': 'v1',
            'Accept': 'application/json', 'Content-Type': 'application/vnd.api+json',
        })
        try:
            with opener.open(req, timeout=45) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            hints = {401: 'Check the organizer API key.', 403: 'Check account access.',
                     429: 'Challonge request quota reached; try after the quota resets.'}
            raise RuntimeError(f'Challonge HTTP {error.code}. ' + hints.get(error.code, 'Request failed; no publication.')) from None
        except Exception:
            raise RuntimeError('Challonge connection or JSON response failed; no publication.') from None
        if not isinstance(payload, dict) or payload.get('errors') or not isinstance(payload.get('data'), list):
            raise ValueError('Unexpected Challonge v2.1 collection response')
        rows = payload['data']
        # Continue to an empty page even if the server caps page size differently.
        if not rows:
            return result
        for row in rows:
            if not isinstance(row, dict) or row.get('type') != kind or not isinstance(row.get('attributes'), dict):
                raise ValueError('Unexpected Challonge resource type or attributes')
            rid = str(row.get('id', ''))
            if not rid.isdigit() or rid in seen:
                raise ValueError('Missing/duplicate Challonge ID or repeated pagination; retry later')
            seen.add(rid)
            result.append(row)
    raise ValueError('Challonge pagination limit reached; refusing a partial import')


def tournaments(key):
    # The v2.1 list schema omits state. Request only ended tournaments explicitly.
    rows = collection('tournaments', key, 'tournament', state='ended')
    output = []
    for row in rows:
        a = row['attributes']
        state = a.get('state', 'ended')
        timestamps = a.get('timestamps') or {}
        output.append(dict(id=row['id'], name=a['name'], url=a['url'],
                           state='complete' if state in ('ended', 'complete') else state,
                           game_name=a.get('game_name'),
                           started_at=a.get('started_at') or timestamps.get('started_at'),
                           start_at=a.get('starts_at'), teams=a.get('teams', False),
                           group_stages_enabled=a.get('group_stage_enabled', False)))
    return output


def participants(eid, key):
    return [dict(id=r['id'], name=r['attributes']['name'])
            for r in collection(f'tournaments/{eid}/participants', key, 'participant')]


def match_record(row):
    a = row['attributes']
    # Challonge documents relationships inside attributes; accept JSON:API's
    # resource-level placement too, without depending on participant array order.
    relationships = a.get('relationships') or row.get('relationships') or {}
    def player(slot):
        data = (relationships.get(slot) or {}).get('data')
        return str(data['id']) if data and data.get('id') is not None else None
    p1, p2 = player('player1'), player('player2')
    winner = str(a['winner_id']) if a.get('winner_id') is not None else None
    if winner is not None and p1 is not None and p2 is not None and winner not in (p1, p2):
        raise ValueError('Match winner is not either opponent')
    loser = (p2 if winner == p1 else p1) if winner in (p1, p2) else None
    score = a.get('scores')
    if a.get('state') == 'complete' and winner and (not p1 or not p2):
        # A bye has at most one participant. Both missing indicates schema drift.
        if not p1 and not p2:
            raise ValueError('Completed match lacks player relationships')
    return dict(id=row['id'], state=a.get('state'), winner_id=winner, loser_id=loser,
                player1_id=p1, player2_id=p2, scores_csv=score,
                suggested_play_order=a.get('suggested_play_order'))


def matches(eid, key):
    return [match_record(r) for r in collection(f'tournaments/{eid}/matches', key, 'match')]
