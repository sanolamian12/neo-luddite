"""정의 조항 따라가기(A5, 10/20) — law_select.definitions 회귀 테스트(Solar 호출 없음, 저장소 대신 조문 몇 개).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_law_definitions -v"""

import os
import unittest

from api import law_select as L


def art(law, no, title, text, paragraphs=None):
    return L.Article(law, no, title, text, paragraphs or [], "")


VAT2 = art("부가가치세법", "2", "정의", "제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.\n"
           "3. “사업자”란 사업상 독립적으로 재화 또는 용역을 공급하는 자를 말한다.\n"
           "4. “간이과세자”(簡易課稅者)란 제61조제1항에 따라 … 개인사업자를 말한다.\n"
           "5. “일반과세자”란 간이과세자가 아닌 사업자를 말한다.")
VAT61 = art("부가가치세법", "61", "간이과세의 적용 범위", "제61조(간이과세의 적용 범위) …")
INC88 = art("소득세법", "88", "정의", "제88조(정의) 이 장에서 사용하는 용어의 뜻은 다음과 같다.\n"
            "1. “양도”란 자산을 유상으로 사실상 이전하는 것을 말한다.\n"
            "7. “주택”이란 사실상 주거용으로 사용하는 건물을 말한다.")
INC89 = art("소득세법", "89", "비과세 양도소득", "제89조(비과세 양도소득) …")
INC1_2 = art("소득세법", "1의2", "정의", "", [
    {"no": 1, "text": "① 이 법에서 사용하는 용어의 뜻은 다음과 같다.\n1. “거주자”란 국내에 주소를 둔 개인을 말한다.\n"
                      "2. “비거주자”란 거주자가 아닌 개인을 말한다.\n3. “내국법인”이란 「법인세법」에 따른 내국법인을 말한다."},
    {"no": 2, "text": "② 생략"}])


class Store:
    by_key = {a.key: a for a in (VAT2, VAT61, INC88, INC89, INC1_2)}


def pick(a):
    return L.Pick(a, [], "", "x")


class Definitions(unittest.TestCase):
    def test_term_item_only(self):
        out = L.definitions("부가가치세법에서 간이과세자가 뭔가요?", [pick(VAT61)], Store())
        self.assertEqual([p.article.key for p in out], [("부가가치세법", "2")])
        self.assertIn("4. “간이과세자”", out[0].excerpt)
        self.assertNotIn("“사업자”", out[0].excerpt)
        self.assertIn("용어의 뜻은", out[0].excerpt)   # 항 머리

    def test_cue_beats_substring(self):
        # '양도소득세' 속 '양도'보다 뜻을 묻는 '주택'
        out = L.definitions("양도소득세에서 주택이란 무엇을 말하나요?", [pick(INC89)], Store())
        self.assertIn("7. “주택”", out[0].excerpt)
        self.assertNotIn("“양도”", out[0].excerpt)

    def test_paragraph_items(self):
        out = L.definitions("거주자와 비거주자는 어떻게 구분하나요?", [pick(INC89)], Store())
        self.assertEqual(out[0].article.key, ("소득세법", "1의2"))
        self.assertIn("1. “거주자”", out[0].excerpt)
        self.assertIn("2. “비거주자”", out[0].excerpt)
        self.assertNotIn("내국법인", out[0].excerpt)

    def test_already_picked_or_no_term(self):
        self.assertEqual(L.definitions("간이과세자가 뭔가요?", [pick(VAT2)], Store()), [])
        self.assertEqual(L.definitions("부가세 신고 기한이 언제인가요?", [pick(VAT61)], Store()), [])

    def test_switch_off(self):
        os.environ["LAW_DEFINITIONS"] = "off"
        try:
            self.assertEqual(L.definitions("간이과세자가 뭔가요?", [pick(VAT61)], Store()), [])
        finally:
            del os.environ["LAW_DEFINITIONS"]


if __name__ == "__main__":
    unittest.main()
