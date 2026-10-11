"""계산 갈래 라우팅(api.pipeline._is_calc_turn) 회귀 테스트 — Solar 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_calc_routing -v

운영 실측 사례를 원문 그대로 둔다: 세무사 10/10 밤 4문항(한 대화) · G01 · Y02 · W01~W05."""

import unittest

from api import pipeline
from api.engine_adapter import CALC_TOPIC
from api.schema import Message, Segment
from calc import income_tax_slots as slots_mod
from calc.test_income_tax_extract import Q2

Q1 = "현재 적용되는 종합소득세율 알려주세요"


def user(text: str, order: int) -> Message:
    return Message(id=f"u{order}", role="user", order=order, segments=[Segment(id=f"u{order}s", text=text, type="question")])


def assistant(text: str, order: int) -> Message:
    return Message(id=f"a{order}", role="assistant", order=order,
                   segments=[Segment(id=f"a{order}s", text=text, type="caveat")])


def routed(text: str, topic, history=()) -> bool:
    history = list(history)
    slots = pipeline._calc_slots(history, text, {})
    return pipeline._is_calc_turn(history, text, {"tax_topic": topic, "etype": "기타"}, slots)


class TaxProSession(unittest.TestCase):
    def test_q2_alone_any_topic(self):
        self.assertTrue(routed(Q2, CALC_TOPIC))
        self.assertTrue(routed(Q2, "종합소득세"))        # 근로자가 관용적으로 '종합소득세'라고 묻는다

    def test_q2_after_q1_in_same_conversation(self):
        hist = [user(Q1, 1), assistant("법령 안내", 2)]
        self.assertTrue(routed(Q2, "종합소득세", hist))

    def test_q2_with_empty_extraction(self):
        self.assertTrue(routed(Q2, None))               # 추출 타임아웃 → 빈 추출이어도 근로 신호로 계산

    def test_q1_rate_question_is_not_calc(self):
        self.assertFalse(routed(Q1, "종합소득세"))       # 세율표 질문은 법령 갈래(F1)


class Regressions(unittest.TestCase):
    def test_g01_freelancer(self):
        self.assertFalse(routed("프리랜서 3.3% 떼고 받았는데 5월에 종소세 신고해야 하나요?", CALC_TOPIC))
        self.assertFalse(routed("프리랜서 3.3% 떼고 받았는데 5월에 종소세 신고해야 하나요?", "종합소득세"))

    def test_y02_deduction_followup(self):
        hist = [user("신용카드 소득공제 얼마나 써야 받을 수 있어요?", 1), assistant("자문", 2)]
        self.assertFalse(routed("연봉 4천이에요", CALC_TOPIC, hist))

    def test_s01_gift(self):
        self.assertFalse(routed("자녀한테 증여하면 얼마까지 세금 없어요?", CALC_TOPIC))

    def test_w_first_turns(self):
        for t in ("연봉 5000인데 내년 소득세 얼마야?", "월급 400만원 받는 직장인인데 세금이 얼마나 떼이나요?",
                  "연봉 7천이면 실수령액이 얼마예요?", "올해 연봉이 3800에서 4500으로 올랐는데 세금 구간이 바뀌나요?",
                  "병원 페이닥터로 연봉 1억 2천 받는데 소득세 대략 얼마 나와요?"):
            self.assertTrue(routed(t, CALC_TOPIC), t)

    def test_short_reply_continues_calc(self):
        hist = [user("연봉 5000인데 내년 소득세 얼마야?", 1), assistant(slots_mod.NOT_MODELED, 2)]
        self.assertTrue(routed("부양가족 2명이에요", "기타", hist))
        self.assertTrue(routed("1인 가구예요", None, hist))


if __name__ == "__main__":
    unittest.main()
