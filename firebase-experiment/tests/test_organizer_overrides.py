import unittest
from engine import build
from organizer_overrides import apply_overrides

class OrganizerEdits(unittest.TestCase):
    def test_corrections_survive_future_imports(self):
        source=dict(event=dict(id='1',slug='one',name='FSC Fall Bracket #1',started='2026-11-01T12:00:00-05:00'),participants=['Alice','Bob','Bye'],matches=[dict(id='a',order=1,winner='Alice',loser='Bob',winnerScore=2,loserScore=0)],skipped=0)
        original=build([source],{})
        override=dict(source=dict(source,event=dict(source['event'],sets=1,skipped=0),matches=[dict(source['matches'][0],winner='Bob',loser='Alice')],reports=[]))
        result=apply_overrides(original,[override],{},[source])
        self.assertEqual(result['matches'][0]['change'],32)
        self.assertEqual(result['players'][0]['name'],'Bob')
        self.assertEqual(next(p for p in result['players'] if p['name']=='Bye')['tournamentCount'],1)
        self.assertEqual(apply_overrides(original,[override],{},[source]),result)
