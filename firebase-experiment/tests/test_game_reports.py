import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_reports import attach_reports

class ReportsTests(unittest.TestCase):
    def setUp(self):
        self.dashboard = {'players': [{'id':'a','elo':1032}], 'matches': [dict(tournament='t',id='m',winner='a',loser='b',winnerScore=2,loserScore=1)]}
        self.report = dict(tournament='t',match='m',status='confirmed',games=[dict(number=i+1,stage='Battlefield',winner=w,characters={'a':'Kazuya','b':'Mario'}) for i,w in enumerate(['a','b','a'])])
    def test_confirmed_and_elo_unchanged(self):
        before = copy.deepcopy(self.dashboard)
        result = attach_reports(self.dashboard,[self.report])
        self.assertEqual(result['gameReports'][0]['status'],'confirmed')
        self.assertEqual(result['players'],before['players'])
        self.assertEqual(result['matches'],before['matches'])
    def test_conflict_excluded(self):
        self.dashboard['matches'][0]['winnerScore']=3
        self.assertEqual(attach_reports(self.dashboard,[self.report])['gameReports'][0]['status'],'needs-review')
    def test_no_games_after_set_end(self):
        for game,winner in zip(self.report['games'],['a','a','b']): game['winner']=winner
        self.assertEqual(attach_reports(self.dashboard,[self.report])['gameReports'][0]['status'],'needs-review')
    def test_pending_not_published(self):
        self.report['status']='pending'
        self.assertEqual(attach_reports(self.dashboard,[self.report])['gameReports'],[])
    def test_unknown_player_rejected(self):
        self.report['games'][0]['winner']='x'
        self.assertEqual(attach_reports(self.dashboard,[self.report])['gameReports'][0]['games'],[])
    def test_duplicate_rejected(self):
        with self.assertRaises(ValueError): attach_reports(self.dashboard,[self.report,self.report])
    def test_missing_character_rejected(self):
        del self.report['games'][0]['characters']['b']
        self.assertEqual(attach_reports(self.dashboard,[self.report])['gameReports'][0]['status'],'needs-review')
