"""Archive organizer-confirmed game notes independently of Challonge availability."""
import json
from pathlib import Path
from google.cloud import firestore


def main():
    notes = json.loads(Path(__file__).with_name('reviewed-games.json').read_text(encoding='utf-8'))
    if notes.get('slug') != 'v3fgwg53' or len(notes.get('sets', [])) != 28:
        raise ValueError('Unexpected reviewed dataset')
    payload = dict(notes, status='confirmed-awaiting-match-link',
                   source='organizer-reviewed-notes', unknownStage='Unknown')
    db = firestore.Client(project='fsc-smash-elo')
    ref = db.document('reviewedGameNotes/' + notes['slug'])

    @firestore.transactional
    def save(transaction):
        old = ref.get(transaction=transaction)
        if old.exists:
            previous = old.to_dict()
            if all(previous.get(k) == v for k, v in payload.items()):
                return
            raise ValueError('Different reviewed notes already exist; review before replacing')
        transaction.set(ref, dict(payload, savedAt=firestore.SERVER_TIMESTAMP))

    save(db.transaction())
    stored = ref.get().to_dict()
    if not all(stored.get(k) == v for k, v in payload.items()):
        raise ValueError('Read-back verification failed')
    count = sum(len(s['games']) for s in stored['sets'])
    print(f"Verified Firebase archive: {len(stored['sets'])} sets, {count} games, {notes['slug']}.")
    print('Public rankings and Elo were not changed. No Challonge requests were made.')


if __name__ == '__main__':
    main()
