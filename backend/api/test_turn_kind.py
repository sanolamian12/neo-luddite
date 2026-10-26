"""이번 턴의 성격(C단계, 10/15) — pipeline._settle_turn_kind · _with_topic_shift_note 회귀 테스트(Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_turn_kind -v

원문은 데모 세트 S02(g5 운영에서 2·3턴이 경비 갈래로 샌 시나리오)와 X05(세무사 4문항 연속)."""

import unittest

from api import pipeline
from api.schema import ChatMeta, ChatResponse, Message, Segment


def user(text: str, order: int) -> Message:
    return Message(id=f"u{order}", role="user", order=order, segments=[Segment(id=f"u{order}s", text=text, type="question")])


HIST = [user("부모님 돌아가시면 상속세 얼마나 나와요?", 0)]


class SettleTurnKind(unittest.TestCase):
    def test_first_turn_is_none(self):
        self.assertIsNone(pipeline._settle_turn_kind([], "상속세 얼마나 나와요?", {"turn_kind": "다른 주제"}))

    def test_statement_is_answer_whatever_model_says(self):
        # 질문 꼴이 아닌 짧은 답을 새 주제로 읽으면 앞 맥락이 통째로 사라진다
        for text in ("아파트 한 채, 시가 15억 정도요", "어머니 살아 계세요", "월 150만원이요"):
            self.assertEqual(pipeline._settle_turn_kind(HIST, text, {"turn_kind": "다른 주제"}), "답변", text)

    def test_question_keeps_model_value(self):
        q = "이번에 새롭게 제조업을 창업하려 합니다. 간이과세자와 일반과세자의 차이가 뭔가요?"
        self.assertEqual(pipeline._settle_turn_kind(HIST, q, {"turn_kind": "다른 주제"}), "다른 주제")
        self.assertEqual(pipeline._settle_turn_kind(HIST, q, {}), "같은 주제")


class TopicShiftNote(unittest.TestCase):
    def test_note_and_box_once(self):
        resp = ChatResponse(message=Message(id="a1", role="assistant", order=1,
                                            segments=[Segment(id="a1_s0", text="본문", type="context")]),
                            meta=ChatMeta())
        out = pipeline._with_topic_shift_note(resp)
        self.assertEqual(out.message.segments[-1].text, pipeline.TOPIC_SHIFT_NOTE)
        self.assertEqual([b.kind for b in out.message.uiBlocks], ["expert_handoff"])
        self.assertEqual(out.meta.handoff, "topic_shift")
        again = pipeline._with_topic_shift_note(out)
        self.assertEqual(len(again.message.segments), 2)
        self.assertEqual(len(again.message.uiBlocks), 1)


if __name__ == "__main__":
    unittest.main()


class VehicleMentioned(unittest.TestCase):
    """업무용승용차 되돌림(10/26 운영 mr1026_r1 C01 2턴 '2억짜리요' — 레이저 장비가 경비 판정 갈래로 감)."""

    def test_no_vehicle_in_conversation(self):
        hist = [user("레이저 장비 새로 샀는데 감가상각 몇 년으로 해요?", 0)]
        self.assertFalse(pipeline._vehicle_mentioned(hist, "2억짜리요"))

    def test_vehicle_in_earlier_turn(self):
        hist = [user("리스 차량 비용 경비 처리돼요?", 0)]
        self.assertTrue(pipeline._vehicle_mentioned(hist, "월 150만원이요"))
        self.assertTrue(pipeline._vehicle_mentioned([], "업무전용보험 들었고 운행기록부도 써요"))
        self.assertTrue(pipeline._vehicle_mentioned([], "벤츠 리스료 경비 되나요?"))
