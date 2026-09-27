"""Execute the atlas search SQL against a disposable relational fixture, never Supabase."""
import sqlite3
import unittest
from unittest.mock import patch
import importlib.util
import sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("atlas_store_test", Path(__file__).parents[1] / "api/rag/kb2_store.py")
kb2_store = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = kb2_store
spec.loader.exec_module(kb2_store)


class Cursor:
    def __init__(self, db): self.cursor = db.cursor()
    def __enter__(self): return self
    def __exit__(self, *args): self.cursor.close()
    def execute(self, sql, params): self.cursor.execute(sql.replace('%s', '?'), params)
    def fetchall(self): return self.cursor.fetchall()


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute("attach database ':memory:' as kb2")
        self.db.executescript('''
          create table kb2.documents(id text, title text, status text);
          create table kb2.sentences(id text, document_id text, content text, status text, order_index int);
          insert into kb2.documents values ('a','경비','active'),('r','retired','retired'),('u','unsorted','unsorted'),('z','archived','archived');
          insert into kb2.sentences values ('1','a','증빙자료 100% A_B','active',0),('2','a','증빙자료 일반','active',1),('3','a','증빙자료','retired',2),('4','r','증빙자료','active',0),('5','u','증빙자료','active',0),('6','z','증빙자료','active',0);
        ''')
        connection = type('Connection', (), {'cursor': lambda _: Cursor(self.db)})()
        self.mock = patch.object(kb2_store, '_get_conn', return_value=connection)
        self.mock.start()

    def tearDown(self):
        self.mock.stop()
        self.db.close()

    def test_search_excludes_disconnected_and_unsearchable_knowledge(self):
        results = kb2_store.search_atlas('증빙자료')
        self.assertEqual([r['id'] for r in results], ['1', '2'])
        self.assertEqual(results[0]['documentTitle'], '경비')

    def test_wildcards_are_literal_and_results_bounded(self):
        self.assertEqual([r['id'] for r in kb2_store.search_atlas('100%')], ['1'])
        self.assertEqual([r['id'] for r in kb2_store.search_atlas('A_B')], ['1'])
        self.assertEqual(len(kb2_store.search_atlas('증빙자료', limit=1)), 1)
        self.assertEqual(kb2_store.search_atlas('   '), [])
        self.assertEqual(kb2_store.search_atlas("' OR 1=1 --"), [])



class UpdateCursor(Cursor):
    def execute(self, sql, params):
        sql = sql.replace('::vector', '').replace('::jsonb', '').replace('(extract(epoch from now()) * 1000)::bigint', '1700000000000')
        self.cursor.execute(sql.replace('%s', '?'), tuple(str(p) if isinstance(p, list) else p for p in params))
    def fetchone(self): return self.cursor.fetchone()


class VersionGuardTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute("attach database ':memory:' as kb2")
        self.db.executescript('''
          create table kb2.sentences(id text, document_id text, order_index int, content text,
            source_passage_ids text, attribution text, locked_by_auditor bool, version int,
            created_at int, updated_at int, locked_by text, lock_acquired_at int, status text, embedding text);
          create table kb2.sentence_versions(sentence_id text, version_no int, content text,
            attribution_snapshot text, editor_type text, editor_id text);
          insert into kb2.sentences values ('s','d',0,'original','[]','[]',false,2,0,0,'expert',0,'active','[]');
        ''')
        connection = type('Connection', (), {'cursor': lambda _: UpdateCursor(self.db)})()
        self.connection = patch.object(kb2_store, '_get_conn', return_value=connection)
        self.decoder = patch.object(kb2_store, '_row_to_sentence', side_effect=lambda row: row)
        self.connection.start(); self.decoder.start()

    def tearDown(self):
        self.connection.stop(); self.decoder.stop(); self.db.close()

    def test_stale_version_cannot_overwrite_newer_expert_work(self):
        result = kb2_store.update_sentence_content('s', 'stale draft', [], 'expert', expected_version=1)
        self.assertIsNone(result)
        self.assertEqual(self.db.execute('select content, version from kb2.sentences').fetchone(), ('original', 2))
        self.assertEqual(self.db.execute('select count(*) from kb2.sentence_versions').fetchone()[0], 0)

    def test_current_version_with_owned_lock_updates_and_records_history(self):
        result = kb2_store.update_sentence_content('s', 'new draft', [], 'expert', expected_version=2)
        self.assertIsNotNone(result)
        self.assertEqual(self.db.execute('select content, version, locked_by from kb2.sentences').fetchone(), ('new draft', 3, None))
        self.assertEqual(self.db.execute('select version_no, content from kb2.sentence_versions').fetchone(), (3, 'new draft'))

    def test_another_editors_lock_prevents_update(self):
        self.assertIsNone(kb2_store.update_sentence_content('s', 'draft', [], 'another', expected_version=2))


if __name__ == '__main__': unittest.main()
