import copy
import json
import sys
import unittest
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import build, change
from manual_sources import manual_source, include_manual
from game_reports import load_reports


class CompleteBracketTests(unittest.TestCase):
    def setUp(self):
        self.source = manual_source()
        self.prior = dict(event=dict(id='1',slug='n7qul9qt',name='FSC Fall Bracket #5',started='2026-11-05T00:00:00Z'),participants=[],matches=[],skipped=0)

    def test_complete_double_elimination_results(self):
        matches = self.source['matches']
        self.assertEqual([m['order'] for m in matches], list(range(1,34)))
        self.assertEqual(len(self.source['participants']),17)
        wins = Counter(m['winner'] for m in matches)
        losses = Counter(m['loser'] for m in matches)
        self.assertEqual((wins['SMT'],losses['SMT']), (6,1))
        self.assertEqual((wins['Thomas'],losses['Thomas']), (4,2))
        self.assertEqual((wins['Never'],losses['Never']), (4,2))
        for p in self.source['participants']:
            self.assertEqual(losses[p],1 if p=='SMT' else 2)

    def test_replay_order_and_reports(self):
        data = load_reports(build([self.source,self.prior], {}))
        self.assertEqual([m['id'] for m in data['matches']], [m['id'] for m in self.source['matches']])
        self.assertEqual(len(data['gameReports']),28)
        self.assertEqual(sum(len(r['games']) for r in data['gameReports']),81)
        ratings = {p:1000 for p in self.source['participants']}
        for m in self.source['matches']:
            delta = change(ratings[m['winner']],ratings[m['loser']])
            ratings[m['winner']] += delta
            ratings[m['loser']] -= delta
        self.assertEqual({p['name']:p['elo'] for p in data['players']},ratings)
        self.assertEqual(sum(ratings.values()),17000)

    def test_repeated_replay_is_identical(self):
        sources=include_manual([self.prior])
        self.assertEqual(build(sources,{}),build(sources,{}))
        self.assertEqual(len(include_manual(sources)),2)

    def test_real_import_replaces_manual_without_duplicate(self):
        real=copy.deepcopy(self.source)
        real['event'].update(id='2',started='2026-11-19T23:00:00Z')
        del real['event']['afterSlug']
        self.assertEqual(len(include_manual([self.prior,real])),2)

    def test_manual_requires_predecessor(self):
        with self.assertRaises(ValueError):build([self.source],{})
