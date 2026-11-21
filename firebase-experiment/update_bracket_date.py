"""Correct bracket #6's calendar date without replaying ratings."""
import copy
import uuid
from datetime import datetime, timezone
from manual_sources import manual_source


def main():
    from google.cloud import firestore
    db = firestore.Client(project='fsc-smash-elo')
    public = db.document('public/dashboard')
    source_ref = db.document('manualSources/v3fgwg53')
    event = manual_source()['event']
    date = event['started']
    revision = uuid.uuid4().hex

    @firestore.transactional
    def update(transaction):
        snapshot = public.get(transaction=transaction)
        source_snapshot = source_ref.get(transaction=transaction)
        if not snapshot.exists or not source_snapshot.exists:
            raise ValueError('Published dashboard and manual source are required')
        old = snapshot.to_dict()
        source = source_snapshot.to_dict()
        tournaments = copy.deepcopy(old['tournaments'])
        matches = [t for t in tournaments if t.get('slug') == event['slug']]
        if len(matches) != 1 or source['event']['slug'] != event['slug']:
            raise ValueError('Expected exactly one bracket #6')
        matches[0]['started'] = date
        matches[0]['datePrecision'] = 'day'
        transaction.set(db.document('dashboardBackups/'+revision), old)
        transaction.update(source_ref, {'event.started': date, 'event.datePrecision': 'day'})
        transaction.update(public, {
            'tournaments': tournaments,
            'revision': revision,
            'updatedAt': datetime.now(timezone.utc).isoformat(),
        })
        return old
    old = update(db.transaction())
    saved = public.get().to_dict()
    event_saved = next(t for t in saved['tournaments'] if t.get('slug') == event['slug'])
    if event_saved['started'] != date:
        raise ValueError('Date read-back failed')
    for key in ('players', 'matches', 'gameReports'):
        if saved.get(key) != old.get(key):
            raise ValueError('Unexpected concurrent change to '+key)
    print('Verified bracket #6 date: November 18, 2026 (America/New_York).')
    print('Players, Elo, sets and game reports unchanged. Previous dashboard backed up.')


if __name__ == '__main__':
    main()
