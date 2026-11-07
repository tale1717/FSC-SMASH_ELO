"""Preview by default. --publish is the only path that writes to Firestore."""
import argparse
import json
import os
import sys
import challonge
import uuid
from datetime import datetime, timezone
from pathlib import Path
from engine import select, normalize, build, validate_size

PROJECT = 'fsc-smash-elo'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--refresh', action='store_true', help='Refetch all selected brackets, including edited results')
    args = parser.parse_args()
    key = os.environ.get('CHALLONGE_API_KEY', '').strip()
    if not key:
        raise ValueError('Set the CHALLONGE_API_KEY secret')
    events = select(challonge.tournaments(key))
    for event in events:
        print(f"Selected {event['name']} | https://challonge.com/{event['slug']}")
    if not args.publish:
        sources = [normalize(event, challonge.participants(event['id'], key),
                             challonge.matches(event['id'], key)) for event in events]
        aliases = json.loads(Path(__file__).with_name('aliases.json').read_text())
        dashboard = build(sources, aliases)
        print(f"Preview: {len(events)} tournaments, {len(dashboard['players'])} players, {len(dashboard['matches'])} sets.")
        print('Preview finished. No Firestore connection or database writes.')
        return
    # Google Cloud client supports Application Default Credentials from GitHub OIDC.
    from google.cloud import firestore
    db = firestore.Client(project=PROJECT)
    public = db.document('public/dashboard')
    old = public.get()
    previous_revision = (old.to_dict() or {}).get('revision')
    cache = {doc.id: doc.to_dict() for doc in db.collection('importSources').stream()}
    selected_ids = {event['id'] for event in events}
    if set(cache) - selected_ids:
        raise ValueError('An imported tournament disappeared from selection; review before replacing rankings')
    sources = []
    updates = {}
    for event in events:
        eid = event['id']
        if eid in cache and not args.refresh:
            source = dict(cache[eid], event=event)
        else:
            source = normalize(event, challonge.participants(eid, key),
                               challonge.matches(eid, key))
        validate_size(source)
        sources.append(source)
        if cache.get(eid) != source:
            updates[eid] = source
    aliases = json.loads(Path(__file__).with_name('aliases.json').read_text())
    dashboard = build(sources, aliases)
    if old.exists and all(old.to_dict().get(k) == v for k, v in dashboard.items()) and not updates:
        print('Already current. No rating changes or writes.')
        return
    if len(updates) > 400:
        raise ValueError('Too many events for one experimental publish')
    dashboard['updatedAt'] = datetime.now(timezone.utc).isoformat()
    dashboard['revision'] = uuid.uuid4().hex
    validate_size(dashboard)

    @firestore.transactional
    def publish(transaction):
        current = public.get(transaction=transaction)
        if (current.to_dict() or {}).get('revision') != previous_revision:
            raise ValueError('Another import published first. Rerun this workflow.')
        for eid, source in updates.items():
            transaction.set(db.document(f'importSources/{eid}'), source)
        transaction.set(public, dashboard)
    publish(db.transaction())
    print(f"Published {len(events)} tournaments, {len(dashboard['players'])} players, {len(dashboard['matches'])} sets.")


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Third-party exceptions can contain request details. Only print safe application errors.
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error), file=sys.stderr)
        else:
            print('Import failed before confirmed publication. Check configuration and credentials.', file=sys.stderr)
        sys.exit(1)
