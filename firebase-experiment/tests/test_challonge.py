"""Synthetic fixtures based on Challonge's v2.1 schemas, not live responses."""
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch, MagicMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import challonge
import importer
from engine import SEEDS, select, normalize, build


def resource(kind, rid, **attrs):
    return dict(type=kind, id=str(rid), attributes=attrs)


def match(winner=2, scores='1 - 2'):
    return resource('match', 10, state='complete', winner_id=winner, scores=scores,
                    suggested_play_order=1, relationships={
                        'player1': {'data': {'id': '1', 'type': 'participant'}},
                        'player2': {'data': {'id': '2', 'type': 'participant'}}})


class ApiTests(unittest.TestCase):
    def transport(self, payloads):
        opener = MagicMock()
        opener.open.side_effect = [io.StringIO(json.dumps(p)) for p in payloads]
        return opener

    def test_pagination_headers_and_short_pages(self):
        opener = self.transport([{'data': [resource('participant', 1, name='A')]},
                                 {'data': [resource('participant', 2, name='B')]}, {'data': []}])
        with patch('challonge.urllib.request.build_opener', return_value=opener):
            self.assertEqual(len(challonge.participants('12', 'secret-test-key')), 2)
        requests = [c.args[0] for c in opener.open.call_args_list]
        self.assertIn('/v2.1/tournaments/12/participants.json?', requests[0].full_url)
        self.assertIn('page=3', requests[-1].full_url)
        self.assertNotIn('secret-test-key', requests[0].full_url)
        headers = {k.lower(): v for k, v in requests[0].header_items()}
        self.assertEqual(headers['authorization'], 'secret-test-key')
        self.assertEqual(headers['authorization-type'], 'v1')
        self.assertEqual(headers['content-type'], 'application/vnd.api+json')

    def test_repeated_page_aborts(self):
        page = {'data': [resource('participant', 1, name='A')]}
        with patch('challonge.urllib.request.build_opener', return_value=self.transport([page, page])):
            with self.assertRaisesRegex(ValueError, 'pagination'):
                challonge.participants('12', 'key')

    def test_malformed_response_aborts(self):
        for payload in ({'data': None}, {'errors': ['failure']}, {'data': [{'id': 1}]}):
            with self.subTest(payload=payload), patch('challonge.urllib.request.build_opener', return_value=self.transport([payload])):
                with self.assertRaises(ValueError):
                    challonge.participants('12', 'key')

    def test_http_error_hides_response_and_key(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError('secret-url', 429, 'secret-key', {}, None)
        with patch('challonge.urllib.request.build_opener', return_value=opener):
            with self.assertRaises(RuntimeError) as error:
                challonge.participants('12', 'key')
        self.assertIn('quota', str(error.exception))
        self.assertNotIn('secret', str(error.exception))

    def test_no_partial_result_at_page_limit(self):
        opener = self.transport([{'data': [resource('participant', 1, name='A')]}])
        with patch('challonge.MAX_PAGES', 1), patch('challonge.urllib.request.build_opener', return_value=opener):
            with self.assertRaisesRegex(ValueError, 'partial'):
                challonge.participants('12', 'key')

    def test_redirect_is_not_followed(self):
        self.assertIsNone(challonge.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.test'))

    def test_v21_selection_and_end_to_end_elo(self):
        rows = [resource('tournament', i+1, name=f'FSC Fall Bracket #{i+1}', url=slug,
                         game_name='Super Smash Bros. Ultimate', starts_at=f'2026-10-{10+i}T19:30:00-04:00',
                         group_stage_enabled=False) for i, slug in enumerate(SEEDS)]
        with patch('challonge.collection', return_value=rows) as request:
            events = select(challonge.tournaments('key'))
        request.assert_called_once_with('tournaments', 'key', 'tournament', state='ended')
        source = normalize(events[0], [{'id': '1', 'name': 'A'}, {'id': '2', 'name': 'B'}],
                           [challonge.match_record(match())])
        dashboard = build([source], {})
        self.assertEqual([(p['name'], p['elo']) for p in dashboard['players']], [('B', 1032), ('A', 968)])

    def test_missing_date_stops_selection(self):
        rows = [resource('tournament', i+1, name=f'FSC Fall Bracket #{i+1}', url=slug,
                         game_name='Super Smash Bros. Ultimate') for i, slug in enumerate(SEEDS)]
        with patch('challonge.collection', return_value=rows):
            with self.assertRaisesRegex(ValueError, 'start date'):
                select(challonge.tournaments('key'))

    def test_winner_and_relationship_validation(self):
        with self.assertRaisesRegex(ValueError, 'opponent'):
            challonge.match_record(match(winner=9))
        broken = match(); del broken['attributes']['relationships']
        with self.assertRaisesRegex(ValueError, 'relationships'):
            challonge.match_record(broken)

    def test_bye_and_dq_exclusion(self):
        bye = match(); bye['attributes']['relationships']['player1']['data'] = None
        event = dict(id='1', started='2026-10-01T12:00:00Z', slug='test', name='Test')
        source = normalize(event, [{'id': 1, 'name': 'A'}, {'id': 2, 'name': 'B'}],
                           [challonge.match_record(match()), challonge.match_record(bye),
                            challonge.match_record(match(scores='-1 - 0'))])
        self.assertEqual((len(source['matches']), source['skipped']), (1, 2))

    def test_preview_validates_without_firestore(self):
        event = dict(id='1', started='2026-10-01T12:00:00Z', slug='test', name='Test')
        with patch.dict('os.environ', {'CHALLONGE_API_KEY': 'key'}), patch.object(sys, 'argv', ['importer.py']), \
             patch('importer.select', return_value=[event]), patch('challonge.tournaments', return_value=[]), \
             patch('challonge.participants', return_value=[{'id': 1, 'name': 'A'}, {'id': 2, 'name': 'B'}]), \
             patch('challonge.matches', return_value=[challonge.match_record(match())]), \
             patch.dict(sys.modules, {'google.cloud': None}), patch('sys.stdout', new_callable=io.StringIO) as output:
            importer.main()
        self.assertIn('1 sets', output.getvalue())
        self.assertIn('No Firestore', output.getvalue())

class OAuthTests(unittest.TestCase):
    def test_client_credentials_and_bearer_requests(self):
        opener = MagicMock()
        opener.open.side_effect = [io.StringIO(json.dumps({'access_token': 'test-token', 'token_type': 'Bearer'})),
                                  io.StringIO(json.dumps({'data': []}))]
        with patch.dict('os.environ', {'CHALLONGE_CLIENT_ID': 'test-id', 'CHALLONGE_CLIENT_SECRET': 'test-secret'}, clear=True), \
             patch('challonge.urllib.request.build_opener', return_value=opener), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            auth = challonge.credentials()
            challonge.collection('tournaments', auth, 'tournament')
        token_request, api_request = [call.args[0] for call in opener.open.call_args_list]
        self.assertEqual(token_request.get_method(), 'POST')
        self.assertNotIn('test-secret', token_request.full_url)
        body = challonge.urllib.parse.parse_qs(token_request.data.decode())
        self.assertEqual(body['grant_type'], ['client_credentials'])
        self.assertEqual(body['client_secret'], ['test-secret'])
        headers = {k.lower():v for k,v in api_request.header_items()}
        self.assertEqual(headers['authorization'], 'Bearer test-token')
        self.assertEqual(headers['authorization-type'], 'v2')
        self.assertEqual(output.getvalue(), '')

    def test_partial_credentials_do_not_fall_back(self):
        with patch.dict('os.environ', {'CHALLONGE_CLIENT_ID': 'id', 'CHALLONGE_API_KEY': 'key'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'both'):
                challonge.credentials()

    def test_token_errors_hide_secrets(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError('secret-url', 401, 'private-response', {}, None)
        with patch.dict('os.environ', {'CHALLONGE_CLIENT_ID': 'id', 'CHALLONGE_CLIENT_SECRET': 'secret'}, clear=True), \
             patch('challonge.urllib.request.build_opener', return_value=opener):
            with self.assertRaises(RuntimeError) as error:
                challonge.credentials()
        self.assertNotIn('private-response', str(error.exception))
        self.assertNotIn('secret-url', str(error.exception))

    def test_invalid_token_response_is_rejected(self):
        for payload in ({}, {'access_token': 'bad\ntoken', 'token_type': 'Bearer'}, {'access_token': 'token', 'token_type': 'Basic'}):
            opener = MagicMock(); opener.open.return_value = io.StringIO(json.dumps(payload))
            with patch.dict('os.environ', {'CHALLONGE_CLIENT_ID': 'id', 'CHALLONGE_CLIENT_SECRET': 'secret'}, clear=True), \
                 patch('challonge.urllib.request.build_opener', return_value=opener):
                with self.assertRaises(ValueError):
                    challonge.credentials()
