import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_reports import resolve_reviewed


class ReviewedGamesTests(unittest.TestCase):
    def setUp(self):
        self.notes = {'slug': 'bracket', 'sets': [dict(players=['SMT', 'Thomas'], occurrence=2,
            games=[dict(number=i+1, stage='Unknown', characters=['Mario', 'Cloud'], winner=w)
                   for i,w in enumerate([1,1,0,0,0])])]}
        self.dashboard = dict(tournaments=[dict(slug='bracket', id='t')],
            players=[dict(name='SMT', id='s'), dict(name='Thomas', id='c')], matches=[
                dict(tournament='t', id='first', winner='c', loser='s', winnerScore=3, loserScore=0),
                dict(tournament='t', id='reset', winner='s', loser='c', winnerScore=3, loserScore=2)])

    def test_rematch_resolution_preserves_results(self):
        before = copy.deepcopy(self.dashboard)
        reports = resolve_reviewed(self.dashboard, self.notes)
        self.assertEqual(reports[0]['match'], 'reset')
        self.assertEqual(reports[0]['games'][0]['winner'], 'c')
        self.assertEqual(reports[0]['games'][0]['stage'], 'Unknown')
        self.assertEqual(self.dashboard, before)

    def test_disagreement_stops_publication(self):
        self.notes['sets'][0]['occurrence'] = 1
        with self.assertRaisesRegex(ValueError, 'disagree'):
            resolve_reviewed(self.dashboard, self.notes)

    def test_missing_event_stops_publication(self):
        self.dashboard['tournaments'] = []
        with self.assertRaisesRegex(ValueError, 'missing'):
            resolve_reviewed(self.dashboard, self.notes)

    def test_reviewed_dataset(self):
        notes = json.loads(Path(__file__).resolve().parents[1].joinpath('reviewed-games.json').read_text())
        self.assertEqual(len(notes['sets']), 28)
        self.assertEqual(sum(len(s['games']) for s in notes['sets']), 81)
        for s in notes['sets']:
            counts = [0, 0]
            target = max(sum(g['winner'] == p for g in s['games']) for p in (0,1))
            for i, g in enumerate(s['games']):
                self.assertEqual(g['number'], i+1)
                self.assertEqual(len(g['characters']), 2)
                counts[g['winner']] += 1
                if i < len(s['games'])-1:
                    self.assertLess(max(counts), target)
