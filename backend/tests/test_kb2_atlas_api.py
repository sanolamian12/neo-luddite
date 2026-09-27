"""HTTP boundary checks; no lifespan, credentials, network, or live database."""
import unittest
from unittest.mock import patch

with patch('dotenv.load_dotenv', return_value=False):
    from api.main import app
from api.rag import kb2_store, embeddings
from fastapi.testclient import TestClient


class AtlasApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)  # Do not start background jobs via lifespan.

    def tearDown(self):
        self.client.close()

    def test_search_reports_unconfigured_storage_without_calling_database(self):
        with patch.object(kb2_store, 'is_configured', return_value=False):
            response = self.client.get('/api/kb2/atlas/search', params={'q': '증빙'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'results': [], 'dbConfigured': False})

    def test_search_rejects_overlong_queries_before_storage_access(self):
        with patch.object(kb2_store, '_get_conn', side_effect=AssertionError('unexpected DB access')):
            response = self.client.get('/api/kb2/atlas/search', params={'q': 'a' * 201})
        self.assertEqual(response.status_code, 422)

    def test_stale_atlas_save_returns_conflict_instead_of_success(self):
        with patch('api.auth.authenticate', return_value=None), patch('api.auth.auth_mode', return_value='optional'), \
             patch.object(kb2_store, 'is_configured', return_value=True), \
             patch.object(embeddings, 'embed_passage', return_value=[]), \
             patch.object(kb2_store, 'update_sentence_content', return_value=None) as update:
            response = self.client.patch('/api/kb2/sentences/s1', json={
                'content': 'draft', 'editorAuditorId': 'expert', 'expectedVersion': 2,
            })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(update.call_args.kwargs['expected_version'], 2)

    def test_legacy_save_request_still_accepts_omitted_version(self):
        with patch('api.auth.authenticate', return_value=None), patch('api.auth.auth_mode', return_value='optional'), \
             patch.object(kb2_store, 'is_configured', return_value=False):
            response = self.client.patch('/api/kb2/sentences/s1', json={
                'content': 'draft', 'editorAuditorId': 'expert',
            })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['dbConfigured'])


if __name__ == '__main__': unittest.main()
