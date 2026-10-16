"""A8(10/16) — 세무사 사례 임베딩 텍스트(결론·예외 포함)와 저장 시 조문 연결(실패해도 저장은 계속). Solar·DB 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_kb3_expert_a8 -v
"""
import unittest
from unittest import mock

from api import law_select
from api.rag import kb3_store

F = {"facts": "사실", "judgment": "판단", "conclusion": "결론 문장", "exceptions": "예외 문장", "keywords": "검색어"}


class _A:
    def __init__(self, law, no):
        self.law, self.no = law, no

    def label(self):
        return law_select.Article.label(self)


class _P:
    def __init__(self, law, no):
        self.article = _A(law, no)


class ExpertEmbedText(unittest.TestCase):
    def test_includes_conclusion_and_exceptions(self):
        t = kb3_store.expert_embed_text("제목", F)
        self.assertEqual(t.split("\n"), ["제목", "사실", "판단", "결론 문장", "예외 문장", "검색어"])

    def test_skips_empty_fields(self):
        t = kb3_store.expert_embed_text("제목", {**F, "exceptions": "", "keywords": ""})
        self.assertEqual(t.split("\n"), ["제목", "사실", "판단", "결론 문장"])


class ExpertLawArticles(unittest.TestCase):
    def test_labels_dedup_and_cap(self):
        picks = [_P("소득세법", "50"), _P("소득세법", "50"), _P("소득세법", "53"), _P("소득세법", "59의2"),
                 _P("법인세법", "1")]
        with mock.patch.object(law_select, "candidates", lambda text, passages: ["c"]), \
                mock.patch.object(law_select, "select", lambda text, cands: picks):
            self.assertEqual(kb3_store.expert_law_articles("t", F),
                             ["소득세법 제50조", "소득세법 제53조", "소득세법 제59조의2"])

    def test_failure_is_empty(self):
        with mock.patch.object(law_select, "candidates", side_effect=RuntimeError("upstage down")):
            self.assertEqual(kb3_store.expert_law_articles("t", F), [])

    def test_select_none_is_empty(self):
        with mock.patch.object(law_select, "candidates", lambda text, passages: []), \
                mock.patch.object(law_select, "select", lambda text, cands: None):
            self.assertEqual(kb3_store.expert_law_articles("t", F), [])


if __name__ == "__main__":
    unittest.main()
