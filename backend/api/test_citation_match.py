"""배지 매칭 부분 문자열 결함(10/20 E K3 발견 → 10/24 고침) — pipeline._mentions · _attach_citations · _tidy_citations (Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_citation_match -v

K3 결론 문단 '소득세법 시행령 제167조의8' 문장에 '소득세법 시행령 제167조' 배지도 붙었다."""

import unittest

from api import pipeline
from api.schema import Segment

K3 = "대주주 기준은 소득세법 시행령 제167조의8 — 본인과 특수관계인(기타주주) 합산 지분 4% 이상입니다."


def seg(i, text):
    return Segment(id=f"s{i}", text=text, type="rule_statement")


class Mentions(unittest.TestCase):
    def test_branch_article_is_other_article(self):
        self.assertFalse(pipeline._mentions("소득세법 시행령 제167조", K3))
        self.assertTrue(pipeline._mentions("소득세법 시행령 제167조의8", K3))

    def test_same_article_forms(self):
        for text in ("소득세법 시행령 제167조제3항에 따라", "소득세법 시행령 제167조 제3항", "소득세법 시행령 제167조의 규정",
                     "소득세법 시행령 제167조.", "(소득세법 시행령 제167조)"):
            self.assertTrue(pipeline._mentions("소득세법 시행령 제167조", text), text)

    def test_particle_after_paragraph(self):
        # 운영 기록에서 본 꼴 — 항·호·목 뒤 '의'는 조사, 띄어 쓴 '의 60세'도 조사
        for label, text in (("소득세법 제50조제1항제3호가목", "소득세법 제50조제1항제3호가목의 60세 이상"),
                            ("소득세법 시행령 제154조제1항", "소득세법 시행령 제154조제1항의 1세대1주택"),
                            ("부가가치세법 시행령 제109조 제1항", "부가가치세법 시행령 제109조 제1항의 1억400만원"),
                            ("국세기본법 제45조", "국세기본법 제45조의 2개 요건")):
            self.assertTrue(pipeline._mentions(label, text), text)
        self.assertFalse(pipeline._mentions("상속세 및 증여세법 제53조", "상속세 및 증여세법 제53조의2(혼인·출산 증여재산 공제)"))
        self.assertFalse(pipeline._mentions("국세기본법 제45조", "국세기본법 제45조의3에 따른 기한 후 신고"))

    def test_digit_after_label(self):
        self.assertFalse(pipeline._mentions("소득세법 제167조의8", "소득세법 제167조의80"))
        self.assertFalse(pipeline._mentions("조심 2020서123", "조심 2020서1234"))

    def test_later_occurrence_counts(self):
        self.assertTrue(pipeline._mentions("소득세법 시행령 제167조", "제167조의8 아닌 소득세법 시행령 제167조의8 및 소득세법 시행령 제167조"))


class AttachAndTidy(unittest.TestCase):
    def test_k3_no_parent_badge(self):
        out = pipeline._attach_citations([seg(0, K3)], [], -1,
                                         laws=["소득세법 시행령 제167조", "소득세법 시행령 제167조의8"])
        self.assertEqual(out[0].citations, ["소득세법 시행령 제167조의8"])

    def test_both_when_both_written(self):
        text = "소득세법 시행령 제167조제3항과 소득세법 시행령 제167조의8을 봅니다."
        out = pipeline._attach_citations([seg(0, text)], [], -1,
                                         laws=["소득세법 시행령 제167조", "소득세법 시행령 제167조의8"])
        self.assertEqual(out[0].citations, ["소득세법 시행령 제167조", "소득세법 시행령 제167조의8"])

    def test_tidy_home_is_sentence_that_writes_it(self):
        # 같은 배지가 두 문장에 붙었으면 그 조문을 적은 문장에 남긴다 — 가지 조문만 적은 문장은 '적은 문장'이 아니다
        a = Segment(id="a", text=K3, type="rule_statement", citations=["소득세법 시행령 제167조"])
        b = Segment(id="b", text="부당행위는 소득세법 시행령 제167조제3항입니다.", type="rule_statement",
                    citations=["소득세법 시행령 제167조"])
        out = pipeline._tidy_citations([a, b])
        self.assertIsNone(out[0].citations)
        self.assertEqual(out[1].citations, ["소득세법 시행령 제167조"])


if __name__ == "__main__":
    unittest.main()
