"""기동 적재 디스크 캐시(egress 대응 10/12) 테스트 — 가짜 커넥션, 운영 DB 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.rag.test_disk_cache -v"""

import os
import tempfile
import unittest

import numpy as np

from api.rag import disk_cache, vec_memory


class FakeCursor:
    def __init__(self, conn, binary=False):
        self.conn, self.binary, self._rows = conn, binary, []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        self.conn.log.append((sql.split()[1][:12], self.binary))
        if "md5(string_agg" in sql:
            self._rows = [(len(self.conn.laws), 1000, self.conn.version)]
        else:
            self._rows = [(law, no, parent, vec) for law, no, parent, vec in self.conn.laws]

    def fetchone(self):
        return self._rows[0]

    def fetchall(self):
        return self._rows

    def __iter__(self):
        return iter(self._rows)


class FakeConn:
    def __init__(self, laws, version="v1"):
        self.laws, self.version, self.log = laws, version, []

    def cursor(self, binary=False):
        return FakeCursor(self, binary)

    def close(self):
        pass


def laws_fixture(n=5, dim=8, seed=0):
    rng = np.random.default_rng(seed)
    return [("소득세법", str(i), "소득세법", rng.standard_normal(dim).astype(np.float32)) for i in range(n)]


class DiskCacheLaws(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["VEC_CACHE_DIR"] = self.tmp.name
        self.conn = FakeConn(laws_fixture())
        self._orig = vec_memory.new_conn
        vec_memory.new_conn = lambda: self.conn

    def tearDown(self):
        vec_memory.new_conn = self._orig
        os.environ.pop("VEC_CACHE_DIR", None)
        self.tmp.cleanup()

    def vector_fetches(self):
        return [b for q, b in self.conn.log if q.startswith("law_name")]

    def test_db_then_cache_same_results(self):
        q = laws_fixture(1, seed=9)[0][3]
        self.assertEqual(vec_memory._load_laws(), 5)
        first = [r for _, r in vec_memory.get("laws").top(q, 3)]
        self.assertEqual(self.vector_fetches(), [True])            # 첫 기동: DB, 바이너리 커서
        self.conn.log.clear()
        self.assertEqual(vec_memory._load_laws(), 5)
        self.assertEqual(self.vector_fetches(), [])                # 두 번째: 지문만, 벡터는 디스크
        self.assertEqual([r for _, r in vec_memory.get("laws").top(q, 3)], first)

    def test_fingerprint_change_refetches(self):
        vec_memory._load_laws()
        self.conn.version = "v2"                                   # 재적재(F1 등)로 해시가 바뀜
        self.conn.log.clear()
        vec_memory._load_laws()
        self.assertEqual(self.vector_fetches(), [True])

    def test_corrupt_cache_refetches(self):
        vec_memory._load_laws()
        (disk_cache.cache_dir() / "laws.pkl").write_bytes(b"broken")
        self.conn.log.clear()
        self.assertEqual(vec_memory._load_laws(), 5)
        self.assertEqual(self.vector_fetches(), [True])

    def test_half_written_cache_ignored(self):
        vec_memory._load_laws()
        (disk_cache.cache_dir() / "laws.fp").unlink()               # 지문 없이 죽은 기록
        self.conn.log.clear()
        vec_memory._load_laws()
        self.assertEqual(self.vector_fetches(), [True])


if __name__ == "__main__":
    unittest.main()
