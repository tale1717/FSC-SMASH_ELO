import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from publish_reviewed import reviewed_history


class OfflineHistoryTests(unittest.TestCase):
    def setUp(self):
        self.notes = json.loads(Path(__file__).resolve().parents[1].joinpath('reviewed-games.json').read_text())

    def test_all_games_are_preserved_without_ratings(self):
        result = reviewed_history(self.notes)
        self.assertEqual(len(result['matches']), 28)
        self.assertEqual(sum(len(r['games']) for r in result['gameReports']), 81)
        self.assertEqual(len({m['id'] for m in result['matches']}), 28)
        self.assertTrue(all(m['change'] is None for m in result['matches']))
        self.assertEqual(sum(g['stage'] == 'Unknown' for r in result['gameReports'] for g in r['games']), 2)

    def test_stable_ids_and_distinct_rematches(self):
        self.assertEqual(reviewed_history(self.notes), reviewed_history(self.notes))
        finals = [s for s in self.notes['sets'] if set(s['players']) == {'Thomas','SMT'}]
        self.assertEqual([s['occurrence'] for s in finals], [1,2,3])

    def test_invalid_sequence_fails(self):
        self.notes['sets'][0]['games'][0]['number'] = 7
        with self.assertRaises(ValueError): reviewed_history(self.notes)

    def test_duplicate_fails(self):
        self.notes['sets'].append(self.notes['sets'][0])
        with self.assertRaises(ValueError): reviewed_history(self.notes)
