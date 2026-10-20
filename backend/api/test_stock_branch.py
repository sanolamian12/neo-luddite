"""주식 양도 계산 갈래(E, STOCK_CALC) — pipeline._stock_plan · _stock_finish 회귀 테스트(Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_stock_branch -v

작문 원문 꼴은 복합 사안 형식(_compound_rule)을 흉내 낸 것(내부 제작). 캡처 기대값은 calc 테스트와 같다(테스트에만 씀)."""

import os
import unittest
from unittest import mock

from api import pipeline
from api.schema import Message, Segment
from calc import stock_transfer_view as stock_view
from calc.test_stock_transfer_slots import CAPTURE_Q


def seg(text, type_="rule_statement"):
    return {"text": text, "type": type_}


def msg(role, order, *texts):
    return Message(id=f"m{order}", role=role, order=order,
                   segments=[Segment(id=f"m{order}_s{i}", text=t, type="context") for i, t in enumerate(texts)])


ON = mock.patch.dict(os.environ, {"STOCK_CALC": "on"})


class Plan(unittest.TestCase):
    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("STOCK_CALC", None)
            self.assertIsNone(pipeline._stock_plan([], CAPTURE_Q, None))

    @ON
    def test_capture_one_case(self):
        p = pipeline._stock_plan([], CAPTURE_Q, "사례 판단")
        self.assertEqual(len(p.scens), 1)
        self.assertEqual(p.scens[0].result.total, 291_050_000)
        self.assertIn("합계: 291,050,000원", p.trace)

    @ON
    def test_not_stock_or_no_amount(self):
        self.assertIsNone(pipeline._stock_plan([], "연봉 5천만원이면 세금이 얼마인가요?", None))
        self.assertIsNone(pipeline._stock_plan([], "주식을 팔면 세금이 얼마인가요?", None))       # 금액 없음 → 기존 갈래
        self.assertIsNone(pipeline._stock_plan([], "비상장주식 양도세율은 몇 %인가요?", "법령 정의"))

    @ON
    def test_missing_then_reply(self):
        q = "비상장 주식을 아들에게 3억에 넘기려고 합니다. 취득가는 1억이에요. 세금이 얼마인가요?"
        p = pipeline._stock_plan([], q, None)
        self.assertIsNone(p.filled.inp)
        self.assertEqual(p.filled.missing_required, ["market_value"])
        ask = pipeline.stock_slots.missing_question(p.filled)
        self.assertTrue(ask.startswith(pipeline._STOCK_MISSING_HEAD))
        hist = [msg("user", 0, q), msg("assistant", 1, ask)]
        p2 = pipeline._stock_plan(hist, "시가는 10억입니다", None)          # 앞 질문에 대한 답 — 대화 발화를 다 읽음
        self.assertIsNotNone(p2.filled.inp)
        self.assertEqual(len(p2.scens), 3)                                 # 지분율·규모를 몰라 경우 3
        self.assertIsNone(pipeline._stock_plan(hist, "고맙습니다", None))   # 슬롯도 주식 낱말도 없으면 잇지 않음


class MultiTurn(unittest.TestCase):
    """경우별 답(계산 답 = NOT_MODELED 고지가 있음) 뒤 짧은 답이 앞 발화를 이어 받아 경우를 줄이거나 세액을 바꾼다(10/20)."""
    K3 = "비상장 주식을 보유하고 있습니다. 시가 10억, 취득가 1억인 주식을 아들에게 3억에 양도하려고 합니다. 세금 문제와 세액을 알려주세요."

    def hist(self, *more):
        h = [msg("user", 0, self.K3), msg("assistant", 1, "요약", stock_view.NOT_MODELED)]
        for i, t in enumerate(more):
            h += [msg("user", 2 + 2 * i, t), msg("assistant", 3 + 2 * i, "요약", stock_view.NOT_MODELED)]
        return h

    @staticmethod
    def totals(p):
        return [sc.result.total for sc in p.scens]

    @ON
    def test_first_answer_three_cases(self):
        self.assertEqual(self.totals(pipeline._stock_plan([], self.K3, "사례 판단")), [291_050_000, 160_040_000, 258_380_000])

    @ON
    def test_share_reply_one_case(self):
        p = pipeline._stock_plan(self.hist(), "지분 30%예요", None)        # 대주주 — 규모와 무관해 1줄
        self.assertEqual(self.totals(p), [291_050_000])

    @ON
    def test_size_reply_two_cases(self):
        p = pipeline._stock_plan(self.hist(), "중소기업이에요", None)      # 주식 낱말 없어도 슬롯(size)이 있으면 잇는다
        self.assertEqual(self.totals(p), [291_050_000, 160_040_000])

    @ON
    def test_minor_reply_changes_gift_tax(self):
        p = pipeline._stock_plan(self.hist(), "아들은 17살이에요", None)   # 경우 수 그대로, 증여재산공제 5천만 → 2천만
        self.assertEqual(self.totals(p), [296_870_000, 165_860_000, 264_200_000])
        self.assertEqual({sc.result.section("gift_tax").tax for sc in p.scens}, {64_020_000})

    @ON
    def test_two_replies_chain(self):
        p = pipeline._stock_plan(self.hist("지분은 3%예요"), "중소기업이에요", None)   # 대화 발화를 다 읽음 — 소액·중소 1줄
        self.assertEqual(self.totals(p), [160_040_000])

    @ON
    def test_unrelated_reply_not_carried(self):
        self.assertIsNone(pipeline._stock_plan(self.hist(), "고맙습니다", None))


class Finish(unittest.TestCase):
    @ON
    def test_finish_capture_without_share(self):
        p = pipeline._stock_plan([], CAPTURE_Q.replace("지분 65%를", "주식을"), None)
        written = [seg("아래는 현행 법령 조문을 중심으로 한 참고 안내입니다.", "caveat"),
                   seg("아버지가 양도소득세를, 아들이 증여세를 냅니다.", "summary"),
                   seg("가정: 특수관계인입니다.", "context"),
                   seg("■ 양도소득세(아버지)", "context"), seg("시가보다 낮게 넘기면 시가로 계산합니다(소득세법 제101조)."),
                   seg("■ 증여세(아들)", "context"), seg("저가 양수 이익은 증여로 봅니다(상속세 및 증여세법 제35조)."),
                   seg("■ 확인할 점", "context"), seg("1. 시가 평가를 확인하세요.", "evidence_request")]
        raw = pipeline._shape_compound(written, CAPTURE_Q, None, calc=True)
        out = pipeline._stock_finish(raw, p)
        texts = [s["text"] for s in out]
        self.assertNotIn(pipeline.COMPOUND_TAX_NOTE, texts)                # 세액은 계산기가 냈다
        self.assertNotIn("아버지가 양도소득세를, 아들이 증여세를 냅니다.", texts)   # 작문 결론 문단 대신 계산기 결론
        self.assertNotIn("가정: 특수관계인입니다.", texts)
        self.assertEqual(out[0]["type"], "caveat")
        self.assertTrue(texts[1].startswith("소득세법상 대주주이면 합계 291,050,000원"))
        self.assertTrue(texts[2].startswith("| 경우 |"))
        self.assertIn("■ 양도소득세(양도자)", texts)                          # 머리를 계산기 머리로
        self.assertIn("■ 증여세(양수자)", texts)
        self.assertIn("■ 증권거래세(양도자)", texts)                          # 작문이 빠뜨린 과세 세목 — 보탬
        i = texts.index("■ 양도소득세(양도자)")
        self.assertEqual(texts[i + 1], "시가보다 낮게 넘기면 시가로 계산합니다(소득세법 제101조).")
        self.assertTrue(texts[i + 2].startswith("| 단계 |"))                # 작문 문장 뒤에 단계 표
        self.assertLess(texts.index("■ 증권거래세(양도자)"), texts.index("■ 확인할 점"))
        self.assertEqual(texts[-2], stock_view.NOT_MODELED)
        self.assertEqual(out[-1]["type"], "follow_up")
        self.assertTrue(texts[-1].startswith("지분율(본인과 특수관계인 합산, 직전 사업연도 말)을"))
        keys = pipeline.stock_view.calc_citation_keys(p.scens)
        self.assertIn(("증권거래세법", "8"), keys)
        self.assertIn(("상속세 및 증여세법 시행령", "26"), keys)

    @ON
    def test_table_before_unheaded_other_tax_lines(self):
        # 로컬 sm1020 M1 t1 꼴 — 마지막 절 뒤에 머리 없는 '양도소득세는 …'·'증여세는 …' 문장. 표는 증권거래세 문장 바로 뒤.
        p = pipeline._stock_plan([], CAPTURE_Q.replace("지분 65%를", "주식을"), None)
        written = [seg("아래는 현행 법령 조문을 중심으로 한 참고 안내입니다.", "caveat"),
                   seg("■ 증권거래세(양도자)", "context"), seg("주권 양도에는 증권거래세가 부과됩니다(증권거래세법 제3조)."),
                   seg("양도소득세는 시가를 양도가액으로 봅니다(소득세법 제101조)."),
                   seg("증여세는 저가 양수 이익에 과세됩니다(상속세 및 증여세법 제35조).")]
        texts = [s["text"] for s in pipeline._stock_finish(pipeline._shape_compound(written, CAPTURE_Q, None, calc=True), p)]
        i = texts.index("■ 증권거래세(양도자)")
        self.assertTrue(texts[i + 2].startswith("| 단계 |"))
        self.assertEqual(texts[i + 3], "양도소득세는 시가를 양도가액으로 봅니다(소득세법 제101조).")


if __name__ == "__main__":
    unittest.main()
