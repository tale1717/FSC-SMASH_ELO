"""Publish reviewed history without fetching Challonge or recalculating Elo."""
import hashlib
import uuid
from datetime import datetime, timezone
from engine import validate_size
from game_reports import attach_reports


def reviewed_history(notes):
    slug = notes['slug']
    if slug != 'v3fgwg53':
        raise ValueError('Unexpected reviewed tournament')
    tid = 'manual:' + slug
    players, matches, reports = {}, [], []
    seen = set()
    for index, entry in enumerate(notes['sets']):
        names = entry['players']
        key = (tuple(sorted(names)), entry['occurrence'])
        if len(names) != 2 or names[0] == names[1] or key in seen:
            raise ValueError('Duplicate or invalid reviewed set')
        seen.add(key)
        ids = [hashlib.sha256(name.encode()).hexdigest() for name in names]
        for pid, name in zip(ids, names):
            players[pid] = dict(id=pid, name=name, historyOnly=True, elo=None,
                                tournamentCount=None, wins=0, losses=0)
        wins = [0, 0]
        games = []
        for game in entry['games']:
            w = game['winner']
            if type(w) is not int or w not in (0, 1) or len(game['characters']) != 2:
                raise ValueError('Invalid reviewed game')
            wins[w] += 1
            games.append(dict(number=game['number'], stage=game['stage'], winner=ids[w],
                              characters=dict(zip(ids, game['characters']))))
        if wins[0] == wins[1] or max(wins) not in (2, 3):
            raise ValueError('Reviewed set is incomplete')
        winner = 0 if wins[0] > wins[1] else 1
        mid = f'manual:{slug}:{index+1}'
        match = dict(id=mid, tournament=tid, winner=ids[winner], loser=ids[1-winner],
                     winnerScore=wins[winner], loserScore=wins[1-winner], change=None,
                     reviewedOnly=True, occurrence=entry['occurrence'])
        report = dict(tournament=tid, match=mid, status='confirmed', games=games)
        checked = attach_reports({'matches': [match]}, [report])['gameReports'][0]
        if checked['status'] != 'confirmed':
            raise ValueError('Invalid reviewed game sequence')
        matches.append(match)
        reports.append(report)
    return dict(schema=1, players=list(players.values()), matches=matches, gameReports=reports,
                tournaments=[dict(id=tid, slug=slug, name='FSC Fall Bracket #6', started=None,
                                  sets=len(matches), reviewedOnly=True)],
                note='Organizer-reviewed history. Partial tournament coverage; Elo and attendance are pending full bracket import.')


def main():
    from google.cloud import firestore
    db = firestore.Client(project='fsc-smash-elo')
    public = db.document('public/dashboard')
    notes_ref = db.document('reviewedGameNotes/v3fgwg53')
    revision = uuid.uuid4().hex

    @firestore.transactional
    def publish(transaction):
        snapshot = public.get(transaction=transaction)
        saved = notes_ref.get(transaction=transaction)
        if not snapshot.exists or not saved.exists:
            raise ValueError('Existing dashboard and confirmed notes are required')
        notes, data = saved.to_dict(), snapshot.to_dict()
        if notes.get('status') != 'confirmed-awaiting-match-link':
            raise ValueError('Notes have not been confirmed')
        if any(t['slug'] == notes['slug'] for t in data['tournaments']):
            raise ValueError('Full tournament already imported; attach real match IDs instead')
        history = reviewed_history(notes)
        if data.get('reviewedHistory') == history:
            return
        data['reviewedHistory'] = history
        data['historyUpdatedAt'] = datetime.now(timezone.utc).isoformat()
        data['revision'] = revision
        validate_size(data)
        transaction.set(public, data)

    publish(db.transaction())
    result = public.get().to_dict()['reviewedHistory']
    print(f"Verified public Firebase history: {len(result['matches'])} sets, "
          f"{sum(len(r['games']) for r in result['gameReports'])} games.")
    print('Elo, ranking records and attendance unchanged. No Challonge requests.')


if __name__ == '__main__':
    main()
