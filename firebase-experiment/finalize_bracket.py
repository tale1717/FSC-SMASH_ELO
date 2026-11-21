"""Replay cached history plus complete, organizer-confirmed bracket #6 offline."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from engine import build, validate_size
from game_reports import load_reports
from manual_sources import include_manual, manual_source


def main():
    from google.cloud import firestore
    db = firestore.Client(project='fsc-smash-elo')
    public = db.document('public/dashboard')
    cached = [s.to_dict() for s in db.collection('importSources').stream()]
    if {s['event']['slug'] for s in cached} != {'3gee2mio','ezus0cc3','knpl9s22','yt30nf6m','n7qul9qt'}:
        raise ValueError('Expected five cached brackets; review changed import history before finalizing')
    aliases = json.loads(Path(__file__).with_name('aliases.json').read_text())
    baseline = build(cached, aliases)
    result = load_reports(build(include_manual(cached), aliases))
    if len(result['matches']) != len(baseline['matches']) + 33 or len(result['gameReports']) != 28:
        raise ValueError('Unexpected complete bracket totals')
    revision = uuid.uuid4().hex
    result['revision'] = revision
    result['updatedAt'] = datetime.now(timezone.utc).isoformat()
    validate_size(result)

    @firestore.transactional
    def publish(transaction):
        snapshot = public.get(transaction=transaction)
        if not snapshot.exists:
            raise ValueError('Existing dashboard is required')
        old = snapshot.to_dict()
        if all(old.get(k) == result[k] for k in ('players','matches','tournaments','gameReports')):
            return
        if any(old.get(k) != baseline[k] for k in ('players','matches','tournaments')):
            raise ValueError('Current rankings differ from cached history; refusing to overwrite')
        transaction.set(db.document('dashboardBackups/'+revision), old)
        transaction.set(db.document('manualSources/v3fgwg53'), manual_source())
        transaction.set(public, result)
    publish(db.transaction())
    saved = public.get().to_dict()
    if any(saved.get(k) != result[k] for k in ('players','matches','tournaments','gameReports')):
        raise ValueError('Final read-back did not match publication')
    print(f"Verified {len(saved['tournaments'])} tournaments, {len(saved['matches'])} total sets.")
    print('Bracket #6: 33 ordered sets; 28 game reports; 81 recorded games.')
    print('Temporary reviewedHistory replaced. Previous dashboard backed up. No Challonge requests.')


if __name__ == '__main__':
    main()
