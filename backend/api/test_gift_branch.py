"""일반 증여 계산 갈래(E 확장, GIFT_CALC) — pipeline._gift_plan · _GiftPlan.finish 회귀 테스트(Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_gift_branch -v

평가 세트 증여 질문의 라우팅(10/26 사용자에게 보인 표)을 고정한다 — S03 만 계산 갈래, 나머지는 종전 경로."""

import os
import unittest
from unittest import mock

from api import pipeline
from api.schema import Message, Segment
from calc import gift_slots, gift_view
from calc import stock_transfer_view as stock_view


def seg(text, type_="rule_statement"):
    return {"text": text, "type": type_}


def msg(role, order, *texts):
    return Message(id=f"m{order}", role=role, order=order,
                   segments=[Segment(id=f"m{order}_s{i}", text=t, type="context") for i, t in enumerate(texts)])


ON = mock.patch.dict(os.environ, {"GIFT_CALC": "on", "STOCK_CALC": "on"})

S03 = "결혼 자금으로 부모님께 1억 받으면 증여세 내야 하나요?"
NOT_ROUTED = {
    "S01": "자녀한테 증여하면 얼마까지 세금 없어요?",
    "X07": "증여세 세율 구간 알려주세요",
    "C27": "부모님께 집 살 돈 2억을 빌리려고 합니다. 차용증을 쓰면 증여세가 안 나오나요? 이자는 꼭 드려야 하나요?",
    "C28": "성인 자녀에게 10년 동안 증여세 없이 줄 수 있는 금액이 얼마인가요? 결혼하면 더 늘어난다던데요.",
    "C29": "부모님 명의 아파트에 제가 공짜로 살고 있는데 이것도 증여세 대상인가요?",
    "C30": "아버지가 제 명의 통장에 돈을 넣어두셨는데 제가 쓰지는 않았어요. 이게 증여로 보나요?",
    "D06": "세법에서 증여의 뜻이 뭔가요?",
    "J05": "자녀 유학비 대 주면 증여세 나오나요?",
}


class Routing(unittest.TestCase):
    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GIFT_CALC", None)
            self.assertIsNone(pipeline._gift_plan([], S03))

    @ON
    def test_eval_set_questions(self):
        for qid, q in NOT_ROUTED.items():
            self.assertIsNone(pipeline._gift_plan([], q), qid)
        self.assertIsNone(pipeline._gift_plan([msg("user", 0, NOT_ROUTED["S01"]), msg("assistant", 1, "답")],
                                              "성인 아들이요"))
        p = pipeline._gift_plan([], S03)
        self.assertEqual(p.outcome, "gift_calc")
        self.assertFalse(p.sec.applies)                       # 5천 + 혼인 5천(받은 금액 한도) → 과표 0
        self.assertEqual(p.issues_extra, ("증여-혼인",))

    @ON
    def test_stock_question_goes_to_stock(self):
        q = "비상장 주식(시가 3억, 취득가 5천만원)을 아들에게 1억에 넘기면 증여세 포함 세금이 얼마인가요?"
        self.assertIsNone(pipeline._gift_plan([], q))
        self.assertIsNotNone(pipeline._stock_plan([], q, "사례 판단"))

    @ON
    def test_missing_then_reply(self):
        q = "아들에게 현금을 증여하면 증여세가 얼마예요?"
        p = pipeline._gift_plan([], q)
        self.assertTrue(p.missing)
        self.assertEqual(p.missing_outcome, "gift_missing")
        ask = p.missing_text()
        hist = [msg("user", 0, q), msg("assistant", 1, ask)]
        p2 = pipeline._gift_plan(hist, "1억이요")
        self.assertFalse(p2.missing)
        self.assertEqual(p2.sec.tax, 4_850_000)               # 1억 − 5천 → 500만 → 3% → 485만
        self.assertIsNone(pipeline._gift_plan(hist, "고맙습니다"))
        # 금액 없이 '나오나요'만 — 사례 판단(J05 꼴)은 묻지 않고 종전 경로
        self.assertIsNone(pipeline._gift_plan([], "딸에게 증여하면 증여세 나오나요?"))

    @ON
    def test_follow_up_after_calc(self):
        q = "아들에게 1억 증여하면 증여세 얼마예요?"
        hist = [msg("user", 0, q), msg("assistant", 1, "요약", gift_view.NOT_MODELED)]
        p = pipeline._gift_plan(hist, "아들은 고등학생이에요")
        self.assertTrue(p.filled.minor)
        self.assertEqual(p.sec.tax, 7_760_000)                # 1억 − 2천 = 8천 → 800만 → 3% → 776만
        p = pipeline._gift_plan(hist, "5년 전에 3천만원 받은 적 있어요")
        self.assertEqual(p.issues_extra, ("증여-합산",))


class Finish(unittest.TestCase):
    @ON
    def test_zero_tax_still_shows_table(self):
        p = pipeline._gift_plan([], S03)
        raw = [seg("아래는 참고 안내입니다.", "caveat"), seg("결론 요약", "summary"), seg("가정: 작문 가정", "context"),
               seg("■ 증여세(수증자)", "context"), seg("부모님께 받은 결혼 자금은 증여세 과세 대상입니다."),
               seg("■ 확인할 점: 1. 혼인신고일을 확인하세요.")]
        out = p.finish(raw)
        texts = [s["text"] for s in out]
        self.assertNotIn("결론 요약", texts)
        self.assertNotIn("가정: 작문 가정", texts)
        self.assertTrue(texts[1].startswith("직계존속(부모)에게서 100,000,000원을 증여받으면"))
        self.assertIn("가정: 혼인신고일 전후 2년 안에", texts[2])
        head = texts.index(stock_view.section_head(p.sec))
        self.assertIn("| 혼인·출산 증여재산공제 |", texts[head + 2])
        self.assertEqual(texts[-2], gift_view.NOT_MODELED)
        self.assertEqual(out[-1]["type"], "follow_up")

    @ON
    def test_section_added_when_writer_skipped_it(self):
        p = pipeline._gift_plan([], "아들에게 3억 증여하면 증여세 얼마예요?")
        out = p.finish([seg("안내", "caveat"), seg("일반 설명입니다.")])
        texts = [s["text"] for s in out]
        self.assertIn("■ 증여세(수증자)", texts)
        self.assertTrue(any("**증여세 38,800,000원**" in t for t in texts))


BURDEN = "전세 3억 낀 시가 10억 아파트를 아들에게 증여하면 증여세 얼마예요?"


class Burden(unittest.TestCase):
    """부담부증여(10/26 밤) — 10/26 운영 결함(10억 전체로 2억1,825만)을 채무 공제 + 증여자 양도세로."""

    @ON
    def test_debt_routed_and_reduced(self):
        p = pipeline._gift_plan([], BURDEN)
        self.assertEqual(p.sec.tax, 130_950_000)
        self.assertTrue(p.burden.no_acq)
        self.assertEqual(p.issues_extra, ("증여-부담부",))
        p = pipeline._gift_plan([], "대출 2억이 남은 집(시가 6억)을 딸에게 증여하면 증여세 얼마예요?")
        self.assertEqual(p.sec.tax, 58_200_000)

    @ON
    def test_living_word_not_excluded_when_debt(self):
        p = pipeline._gift_plan([], "전세 끼고 사는 집인데 부모님이 시가 5억 집을 증여해주시면 증여세 얼마예요? 전세 2억이에요")
        self.assertEqual((p.filled.donor, p.filled.debt), ("parent", 200_000_000))
        self.assertIsNone(pipeline._gift_plan([], NOT_ROUTED["C29"]))

    @ON
    def test_debt_amount_asked_then_reply(self):
        q = "부담부증여로 아파트 시가 7억을 딸에게 주면 얼마예요?"
        p = pipeline._gift_plan([], q)
        self.assertTrue(p.missing)
        hist = [msg("user", 0, q), msg("assistant", 1, p.missing_text())]
        p2 = pipeline._gift_plan(hist, "전세 3억이요")
        self.assertEqual((p2.filled.debt, p2.sec.tax), (300_000_000, 58_200_000))

    @ON
    def test_follow_up_acquisition(self):
        hist = [msg("user", 0, BURDEN), msg("assistant", 1, "요약", gift_view.NOT_MODELED_BURDEN)]
        p = pipeline._gift_plan(hist, "아버지가 3억에 사셨고 10년 전에 사신 거예요. 집이 두 채예요")
        self.assertEqual(p.burden.cg.tax, 42_950_000)          # 3억 × 3/10 = 9천 → 차익 2.1억 − 20% − 250만 = 1.655억 → 3,706만 + 1,550만 × 38%
        self.assertIn("양도세-부동산", p.issues_extra)

    @ON
    def test_finish_adds_transfer_sections(self):
        q = "아버지가 10년 전에 3억에 산 아파트(시가 9억, 전세 4억)를 저한테 부담부증여하면 세금 얼마예요? 집이 두 채예요"
        p = pipeline._gift_plan([], q)
        out = p.finish([seg("안내", "caveat"), seg("■ 증여세(수증자)", "context"), seg("일반 설명입니다.")])
        texts = [s["text"] for s in out]
        self.assertIn("■ 양도소득세(증여자)", texts)
        self.assertIn("■ 개인지방소득세(양도소득분)(증여자)", texts)
        self.assertTrue(any("**양도소득세 60,176,666원**" in t for t in texts))
        self.assertEqual(texts[-2], gift_view.NOT_MODELED_BURDEN)
        self.assertTrue(any(t.startswith("참고로 채무 없이") for t in texts))


class GrandparentSummed(unittest.TestCase):
    """조부모 증여 + 10년 합산(10/26 밤, 시행령 §46의3② 계산식 API 원문 복원) — 종전엔 합산하지 않았다."""

    @ON
    def test_minor_grandchild_with_prior(self):
        p = pipeline._gift_plan([], "할아버지께서 고등학생 손자에게 3억을 증여하시면 증여세가 얼마예요? 3년 전에도 5천만원 주셨어요")
        self.assertEqual(p.filled.prior_gifts, 50_000_000)
        self.assertEqual(p.sec.tax, 66_833_000)          # 과표 3.3억 → 5,600만 · 할증 1,680만 − 90만 · 공제 300만 · 3%
        self.assertEqual(p.issues_extra, ("증여-합산", "증여-세대생략합산"))


class MarriageCheck(unittest.TestCase):
    @ON
    def test_only_when_marriage_deduction_applied(self):
        p = pipeline._gift_plan([], S03)
        out = p.finish([seg("안내", "caveat"), seg("일반 설명입니다.")])
        i = [s["text"] for s in out].index(gift_view.MARRIAGE_CHECK)
        self.assertEqual(out[i + 1]["text"], gift_view.NOT_MODELED)
        for q in ("아들에게 1억 증여하면 증여세 얼마예요?", "출산하고 부모님께 1억 받으면 증여세 얼마예요?"):
            texts = [s["text"] for s in pipeline._gift_plan([], q).finish([seg("일반 설명입니다.")])]
            self.assertNotIn(gift_view.MARRIAGE_CHECK, texts, q)


class Slots(unittest.TestCase):
    def test_assumptions_and_invite(self):
        f = gift_slots.fill({"value": 100_000_000})
        self.assertEqual(f.donor, "other")
        self.assertEqual(f.assumed, ["relation", "prior_gifts"])
        sec = gift_slots.compute(f)
        self.assertEqual(sec.tax, 9_700_000)                  # 공제 없음 1억 → 1천만 → 3%
        self.assertIn("주는 분과 받는 분의 관계", gift_slots.invite(f, sec))

    def test_small_prior_uses_deduction(self):
        f = gift_slots.fill({"value": 100_000_000, "relation": "child", "minor": False, "prior_gifts": 9_000_000})
        self.assertEqual((f.prior_gifts, f.prior_used), (0, 9_000_000))
        self.assertEqual(gift_slots.compute(f).steps[1].amount, 41_000_000)

    def test_grandparent_prior_summed(self):
        f = gift_slots.fill({"value": 300_000_000, "relation": "grandchild", "minor": False, "prior_gifts": 100_000_000})
        sec = gift_slots.compute(f)
        self.assertTrue(any(s.key == "gift_prior" for s in sec.steps))
        self.assertEqual(sec.tax, 69_355_000)
        self.assertIn("세대생략 할증을 받고", gift_view.assumed_line(f, sec))


if __name__ == "__main__":
    unittest.main()
