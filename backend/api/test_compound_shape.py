"""복합 사안 모양 마무리(규칙 8 과제 3, 10/16) — pipeline._shape_compound 회귀 테스트(Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_compound_shape -v

원문 꼴은 10/16 로컬 C1(비상장주식 아들 저가양도, 세목 3개) — ① 세그먼트 23개가 전체 상한 16 에서 잘려 ■ 확인할 점이 통째로 빠짐
② '■ 확인할 점 — 1. … 2. …' 를 caveat 한 덩이로 써서 머리가 빠지고 항목이 안 갈림."""

import unittest

from api import pipeline

Q = "비상장주식을 아들에게 저가로 양도하려고 합니다. 어떤 세금문제가 발생하는지 알려주세요"


def seg(text, type_="rule_statement"):
    return {"text": text, "type": type_}


class CompoundShape(unittest.TestCase):
    def test_sections_capped_not_tail_cut(self):
        raw = [seg("결론입니다.", "summary"), seg("가정: 특수관계인으로 전제합니다.", "context")]
        for tax in ("양도소득세(아버지)", "증여세(아들)", "증권거래세(아버지)"):
            raw += [seg(f"■ {tax}", "context")] + [seg(f"{tax} 문장 {i}.") for i in range(6)]
        raw += [seg("■ 확인할 점", "context")] + [seg(f"{i}. 확인 {i}.", "evidence_request") for i in range(1, 7)]
        out = [s["text"] for s in pipeline._shape_compound(raw, Q)]
        self.assertIn("■ 증권거래세(아버지)", out)
        self.assertIn("■ 확인할 점", out)
        self.assertEqual(sum(t.startswith("증권거래세(아버지) 문장") for t in out), pipeline.COMPOUND_SECTION_BODY)
        self.assertEqual(sum(t[:2] in {f"{i}." for i in range(1, 10)} for t in out), pipeline.COMPOUND_CHECK_ITEMS)

    def test_check_items_written_as_caveat(self):
        raw = [seg("결론입니다.", "summary"), seg("■ 증권거래세(아버지)", "context"), seg("세율은 1만분의 35입니다."),
               seg("■ 확인할 점", "context"), seg("1. 특수관계인인지 확인이 필요합니다. 2. 시가가 맞는지 확인이 필요합니다.", "caveat")]
        out = pipeline._shape_compound(raw, Q)
        texts = [s["text"] for s in out]
        self.assertIn("■ 확인할 점", texts)
        self.assertIn("1. 특수관계인인지 확인이 필요합니다.", texts)
        self.assertIn("2. 시가가 맞는지 확인이 필요합니다.", texts)


class MissingHeads(unittest.TestCase):
    """10/16 로컬 C1 3회차 — 증권거래세 문장을 ■ 증여세 절 끝에 붙여 썼다."""

    RAW = [seg("결론입니다.", "summary"), seg("■ 증여세(아들)", "context"), seg("증여세는 제35조로 봅니다."),
           seg("비상장주식 양도 시 증권거래세 납세의무자는 양도자인 아버지이고, 세율은 1만분의 35입니다."),
           seg("■ 확인할 점", "context"), seg("1. 증권거래세 신고 기한을 확인해야 합니다.", "evidence_request")]

    def test_head_inserted_before_leading_sentence(self):
        out = [s["text"] for s in pipeline._shape_compound(list(self.RAW), Q, ["증여세", "증권거래세"])]
        i = out.index("■ 증권거래세")
        self.assertTrue(out[i + 1].startswith("비상장주식 양도 시 증권거래세"))
        self.assertEqual(out.count("■ 증권거래세"), 1)       # 확인할 점 항목 앞에는 넣지 않는다

    def test_head_inserted_by_citations(self):
        # g3: 세목 이름 없이 쓴 문장 — 배지가 전부 증권거래세법
        raw = [seg("결론입니다.", "summary"), seg("■ 증여세(아들)", "context"), seg("증여세는 제35조로 봅니다."),
               {"text": "주권등을 양도하는 경우 양도자가 납세의무자이고, 세율은 1만분의 35입니다.", "type": "rule_statement",
                "citations": ["증권거래세법 제3조(납세의무자) 제3호", "증권거래세법 제8조(세율)"]}]
        out = [s["text"] for s in pipeline._shape_compound(raw, Q, ["증여세", "증권거래세"])]
        self.assertTrue(out[out.index("■ 증권거래세") + 1].startswith("주권등을 양도하는"))

    def test_no_heads_no_change(self):
        out = [s["text"] for s in pipeline._shape_compound(list(self.RAW), Q)]
        self.assertNotIn("■ 증권거래세", out)


if __name__ == "__main__":
    unittest.main()
