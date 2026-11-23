import unittest
from dynamic_aliases import apply_aliases

class DynamicAliasTests(unittest.TestCase):
    def test_replay_and_reports(self):
        base={'players':[dict(id=i,name=n,tournamentCount=1,tournamentIds=['t']) for i,n in [('a','Main'),('b','Alt'),('c','Other')]],'matches':[dict(id='1',tournament='t',winner='a',loser='c'),dict(id='2',tournament='t',winner='b',loser='c')],'gameReports':[{'games':[dict(winner='b',characters={'b':'Mario','c':'Cloud'})]}]}
        result=apply_aliases(base,{'Alt':'Main'})
        main=next(p for p in result['players'] if p['id']=='a')
        self.assertEqual(main['elo'],1058)
        self.assertEqual(main['tournamentCount'],1)
        self.assertEqual(result['gameReports'][0]['games'][0]['winner'],'a')
        self.assertEqual(result['aliases'],{'Alt':'Main'})
        self.assertEqual(base['matches'][1]['winner'],'b')
        with self.assertRaises(ValueError):
            apply_aliases(base,{'Other':'Main'})
        with self.assertRaises(ValueError):
            apply_aliases(base,{'Alt':'Main','Main':'Alt'})
