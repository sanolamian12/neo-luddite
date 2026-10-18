"""계산 갈래 라우팅(api.pipeline._is_calc_turn) 회귀 테스트 — Solar 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_calc_routing -v

운영 실측 사례를 원문 그대로 둔다: 세무사 10/10 밤 4문항(한 대화) · G01 · Y02 · W01~W05."""

import os
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


    def test_calc_followup_beats_expense_etype(self):
        # W01 3턴 운영 10/12 — 추출기가 경비 유형을 잡아도 바로 앞이 계산이고 경비 낱말이 없으면 계산
        hist = [user("연봉 5000인데 내년 소득세 얼마야?", 1), assistant(slots_mod.NOT_MODELED, 2)]
        slots = pipeline._calc_slots(hist, "4대보험만 내요", {})
        self.assertTrue(pipeline._is_calc_turn(hist, "4대보험만 내요", {"tax_topic": "인건비·4대보험", "etype": "복리후생비"}, slots))
        slots = pipeline._calc_slots(hist, "그럼 차량 리스비는 경비 돼요?", {})
        self.assertFalse(pipeline._is_calc_turn(hist, "그럼 차량 리스비는 경비 돼요?", {"tax_topic": "업무용승용차", "etype": "업무용승용차"}, slots))

    def test_new_question_after_calc_is_not_calc(self):
        # X05 4턴 운영 10/12 — 계산 답 뒤 다른 세목의 새 질문
        q4 = "법인세에서 익금이라는게 있는데 익금이 정확히 뭔가요? 근거를 바탕으로 설명해주세요"
        hist = [user(Q2, 1), assistant(slots_mod.NOT_MODELED, 2)]
        self.assertFalse(routed(q4, "기타", hist))
        # 계산이 두 턴 전이면 짧은 답도 이어 받지 않는다
        hist2 = hist + [user("간이과세 요건이 뭐예요", 3), assistant("자문", 4)]
        self.assertFalse(routed("2명이요", "기타", hist2))

    def test_long_followup_with_slots_continues(self):
        hist = [user("직장인인데 세금 얼마나 떼요?", 1), assistant(slots_mod.SLOT["total_salary"].question, 2)]
        self.assertTrue(routed("연봉은 5천이고 부양가족은 아내 한 명인데 소득은 없어요", "기타", hist))



class ThirdEvalSession(unittest.TestCase):
    """세무사 3차 평가(10/18 운영) — 한 대화 8턴 끝의 "연봉 7천만원 실수령액을 알려주세요"(20자)가 짧은 답으로 취급돼
    직전 발화 "증여세 세율 구간 알려주세요"의 '증여'에 막혀 자문 갈래로 갔다."""

    def test_short_complete_calc_question_after_gift_question(self):
        hist = [user(Q2, 1), assistant(slots_mod.NOT_MODELED, 2), user("증여세 세율 구간 알려주세요", 3), assistant("세율표", 4)]
        self.assertTrue(routed("연봉 7천만원 실수령액을 알려주세요", CALC_TOPIC, hist))
        self.assertTrue(routed("연봉 7천 세후 얼마예요?", CALC_TOPIC, hist))

    def test_new_calc_question_does_not_inherit_earlier_family(self):
        hist = [user(Q2, 1), assistant(slots_mod.NOT_MODELED, 2), user("증여세 세율 구간 알려주세요", 3), assistant("세율표", 4)]
        slots = pipeline._calc_slots(hist, "연봉 7천만원 실수령액을 알려주세요", {"dependents": 2, "disabled": 1})
        self.assertEqual(slots, {"total_salary": 70_000_000})

    def test_followup_still_inherits(self):
        hist = [user("연봉 7천이면 실수령액이 얼마예요?", 1), assistant(slots_mod.INVITE, 2)]
        self.assertTrue(routed("배우자랑 애 하나 있어요", "기타", hist))
        slots = pipeline._calc_slots(hist, "배우자랑 애 하나 있어요", {})
        self.assertEqual(slots["total_salary"], 70_000_000)
        self.assertEqual(slots["kids"], 1)
        self.assertEqual(pipeline._calc_slots(hist, "2명이요", {}).get("dependents"), 2)   # 청하는 문장 뒤 짧은 답


class AskFirst(unittest.TestCase):
    """세무사 피드백 10/13 — 연봉만 들어오면 계산 전에 결과를 바꾸는 정보 2문항을 먼저 묻는다. 3차 평가(10/18) 뒤 기본 off —
    CALC_ASK_FIRST=on 일 때의 동작을 확인한다."""

    def setUp(self):
        self._env = os.environ.get("CALC_ASK_FIRST")
        os.environ["CALC_ASK_FIRST"] = "on"

    def tearDown(self):
        if self._env is None:
            os.environ.pop("CALC_ASK_FIRST", None)
        else:
            os.environ["CALC_ASK_FIRST"] = self._env

    def test_default_off_computes(self):
        os.environ.pop("CALC_ASK_FIRST", None)
        self.assertFalse(self.decide("연봉 5천만원이면 근로소득세 얼마야?"))

    def decide(self, text, history=()):
        history = list(history)
        filled = slots_mod.fill(pipeline._calc_slots(history, text, {}))
        return pipeline._calc_should_ask_first(history, text, filled)

    def test_salary_only_asks_first(self):
        self.assertTrue(self.decide("연봉 5천만원이면 근로소득세 얼마야?"))

    def test_rough_request_computes(self):
        self.assertFalse(self.decide("연봉 5천인데 대략 소득세 얼마인지 러프하게 계산해줘"))

    def test_rich_question_computes(self):
        self.assertFalse(self.decide(Q2))                      # 부양가족까지 말한 세무사 Q2

    def test_bracket_change_computes(self):
        self.assertFalse(self.decide("올해 연봉이 3800에서 4500으로 올랐는데 세금 구간이 바뀌나요?"))

    def test_second_turn_computes_even_without_answers(self):
        q = slots_mod.SLOT["dependents"].question
        hist = [user("연봉 5천만원이면 근로소득세 얼마야?", 1), assistant(q, 2)]
        self.assertFalse(self.decide("네 근로계약서 쓴 정규직이에요", hist))
        long_rough = "그냥 일반사무직이고 나머진 그냥 가정해서 계산해줘. 러프하게해줘"
        self.assertTrue(pipeline._calc_followup(hist, long_rough))   # 25자 넘어도 '러프하게'면 계산 이어 받기
        self.assertFalse(self.decide(long_rough, hist))


if __name__ == "__main__":
    unittest.main()
