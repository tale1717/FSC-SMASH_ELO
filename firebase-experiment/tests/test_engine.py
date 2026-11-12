import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import SEEDS, select, normalize, build, change, identity, validate_size

class EngineTests(unittest.TestCase):
    def events(self):
        return [dict(id=i+1,url=s,name=f'FSC Fall Bracket #{i+1}',state='complete',game_id=99,
                     started_at=f'2026-10-{10+i}T19:30:00-04:00') for i,s in enumerate(SEEDS)]
    def source(self):
        event=select(self.events())[0]
        participants=[dict(id=1,name='A'),dict(id=2,name='B')]
        match=dict(id=10,state='complete',winner_id=1,loser_id=2,player1_id=1,player2_id=2,scores_csv='2-1')
        return normalize(event,participants,[match])
    def test_attendance_distinct_tournaments_and_aliases(self):
        sources=[]
        for i in range(4):
            source=copy.deepcopy(self.source())
            source['event'].update(id=str(i+1),started=f'2026-10-{10+i}T19:30:00-04:00')
            source['participants']=['A','Alt','B','Registered']
            source['matches'].append(dict(source['matches'][0],id='11'))
            sources.append(source)
        result=build(sources,{'Alt':'A'})
        self.assertEqual({p['name']:p['tournamentCount'] for p in result['players']},{'A':4,'B':4,'Registered':4})
        self.assertEqual(len(result['matches']),8)
        self.assertEqual(build(sources[:3],{'Alt':'A'})['players'][0]['tournamentCount'],3)

    def test_selection(self):
        events=self.events()
        for i,(name,state,game,date) in enumerate([
            ('FSC Fall Bracket #5','complete',99,'2026-11-01T20:00:00Z'),
            ('FSC Fall Bracket #0','complete',99,'2025-11-01T20:00:00Z'),
            ('FSC Fall Bracket #6','pending',99,'2026-11-02T20:00:00Z'),
            ('FSC Fall Bracket #7','complete',10,'2026-11-03T20:00:00Z'),
            ('Other','complete',99,'2026-11-04T20:00:00Z')]):
            events.append(dict(id=i+5,url=str(i+5),name=name,state=state,game_id=game,started_at=date))
        self.assertEqual([t['id'] for t in select(events)],['1','2','3','4','5'])
    def test_requires_full_history(self):
        with self.assertRaises(ValueError): select(self.events()[1:])
    def test_refuses_groups(self):
        events=self.events(); events[0]['group_stages_enabled']=True
        with self.assertRaises(ValueError): select(events)
    def test_elo_values(self):
        self.assertEqual(change(1000,1000),32)
        self.assertEqual(change(1200,1000),15)
        self.assertEqual(change(1000,1200),49)
        self.assertEqual(change(1000,1400),58)
        self.assertEqual(change(1400,1000),6)
    def test_scores_do_not_change_ratings_or_records(self):
        source=self.source()
        baseline=build([source],{})
        for winner_score, loser_score in [(2,0),(2,1),(3,0),(3,1),(3,2)]:
            with self.subTest(score=(winner_score,loser_score)):
                variant=copy.deepcopy(source)
                variant['matches'][0].update(winnerScore=winner_score,loserScore=loser_score)
                result=build([variant],{})
                self.assertEqual(result['players'],baseline['players'])
                self.assertEqual(result['matches'][0]['change'],32)
                self.assertEqual(result['matches'][0]['winnerScore'],winner_score)
                self.assertEqual(result['matches'][0]['loserScore'],loser_score)
    def test_full_replay_uses_updated_opponent_ratings(self):
        first=self.source()
        second=copy.deepcopy(first)
        second['event'].update(id='2',started='2026-10-11T19:30:00-04:00')
        second['matches'][0].update(winner='B',loser='A',winnerScore=3,loserScore=0)
        result=build([second,first],{})
        self.assertEqual([m['change'] for m in result['matches']],[32,38])
        self.assertEqual({p['name']:p['elo'] for p in result['players']},{'A':994,'B':1006})
        self.assertTrue(all(p['wins']==1 and p['losses']==1 for p in result['players']))
        self.assertEqual(result,build([first,second],{}))
    def test_replay_idempotent_zero_sum(self):
        source=self.source()
        a=build([source],{}); b=build([source],{})
        self.assertEqual(a,b)
        self.assertEqual(sum(p['elo'] for p in a['players']),2000)
        self.assertEqual(len(a['matches']),1)
    def test_alias_rebuild(self):
        result=build([self.source()],{'A':'Alice'})
        self.assertEqual({p['name'] for p in result['players']},{'Alice','B'})
    def test_alias_collision_refused(self):
        with self.assertRaises(ValueError): build([self.source()],{'A':'B'})
    def test_alias_cycle(self):
        with self.assertRaises(ValueError): identity('A',{'A':'B','B':'A'})
    def test_duplicate_event_refused(self):
        source=self.source()
        with self.assertRaises(ValueError): build([source,source],{})
    def test_dq_and_bye_excluded(self):
        e=select(self.events())[0]; people=[dict(id=1,name='A'),dict(id=2,name='B')]
        base=dict(id=10,state='complete',winner_id=1,loser_id=2,player1_id=1,player2_id=2,scores_csv='2-0')
        source=normalize(e,people,[base,dict(base,id=11,scores_csv='0--1'),dict(base,id=12,loser_id=None)])
        self.assertEqual(len(source['matches']),1); self.assertEqual(source['skipped'],2)
    def test_inconsistent_winner_refused(self):
        with self.assertRaises(ValueError):
            normalize(select(self.events())[0],[dict(id=1,name='A'),dict(id=2,name='B')],
                [dict(id=1,state='complete',winner_id=2,loser_id=1,player1_id=1,player2_id=2,scores_csv='2-0')])
    def test_size_guard(self):
        with self.assertRaises(ValueError): validate_size({'data':'x'*750001})

if __name__=='__main__': unittest.main()
