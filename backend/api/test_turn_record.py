"""사용 현황 M2(0063) 턴 기록 보조 테스트 — 네트워크·DB 없음. 실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_turn_record"""

import unittest
from contextvars import copy_context
from unittest import mock

from api import pipeline, turn_record
from api.schema import ChatMeta, ChatResponse, Message, Segment


def _resp(meta: ChatMeta) -> ChatResponse:
    msg = Message(id="asst_local-1_1", role="assistant", order=1, segments=[Segment(id="s1", text="답", type="summary")])
    return ChatResponse(message=msg, meta=meta)


class MaskTest(unittest.TestCase):
    def test_masks_identifiers(self):
        cases = {
            "연락처 010-1234-5678 로 주세요": "연락처 [가림] 로 주세요",
            "01012345678": "[가림]",
            "사무실 02-123-4567": "사무실 [가림]",
            "메일 boss@shop.co.kr 입니다": "메일 [가림] 입니다",
            "주민번호 900101-1234567": "주민번호 [가림]",
            "사업자 123-45-67890 입니다": "사업자 [가림] 입니다",
            "계좌 110-123-456789": "계좌 [가림]",
        }
        for raw, want in cases.items():
            self.assertEqual(turn_record.mask(raw), want, raw)

    def test_keeps_tax_content(self):
        for text in ("연봉 5,000만원이면 소득세 얼마예요?", "2024-10-23 에 산 차량 감가상각", "부가세 10% 1,200,000원",
                     "직원 3명, 월급 250만원"):
            self.assertEqual(turn_record.mask(text), text)


class FieldsTest(unittest.TestCase):
    def test_channel(self):
        self.assertEqual(turn_record.channel("local-abc"), "chat")
        self.assertEqual(turn_record.channel("room_1"), "room")
        self.assertEqual(turn_record.channel("studio_a_1"), "studio")
        self.assertEqual(turn_record.channel("eval-r0-1"), "eval")

    def test_fields_and_question(self):
        def run():
            turn_record.bind("  제 번호 010-1111-2222, 차량 경비 되나요?  ")
            meta = ChatMeta(extracted={"tax_topic": "업무용승용차", "question_type": "요건"}, handoff="advisory")
            got = turn_record.fields(_resp(meta), "local-1")
            self.assertEqual({k: got[k] for k in ("channel", "tax_topic", "question_type", "handoff_reason")},
                             {"channel": "chat", "tax_topic": "업무용승용차", "question_type": "요건", "handoff_reason": "advisory"})
            self.assertIsInstance(got["latency_ms"], int)
            self.assertEqual(turn_record.question("local-1"), "제 번호 [가림], 차량 경비 되나요?")
            self.assertIsNone(turn_record.question("room_9"))
            self.assertIsNone(turn_record.question("eval-x"))
        copy_context().run(run)

    def test_unbound_context(self):
        def run():
            got = turn_record.fields(_resp(ChatMeta()), "local-1")
            self.assertEqual((got["tax_topic"], got["latency_ms"]), (None, None))
            self.assertIsNone(turn_record.question("local-1"))
        copy_context().run(run)

    def test_question_capped(self):
        def run():
            turn_record.bind("가" * 900)
            self.assertEqual(len(turn_record.question("local-1")), turn_record.MAX_QUESTION)
        copy_context().run(run)


class RecordedTest(unittest.TestCase):
    """_recorded 가 새 값을 넘기고, 보조가 실패해도 응답을 그대로 돌려주는지."""

    def test_passes_extra_and_question(self):
        def run():
            turn_record.bind("부가세 신고 기한이 언제예요?")
            resp = _resp(ChatMeta(extracted={"tax_topic": "부가가치세", "question_type": "절차"}))
            with mock.patch("api.rag.store.record_chat_turn") as rec, mock.patch("api.rag.store.record_question") as q:
                out = pipeline._recorded(resp, "local-1", "clinic", "advisory", None, True)
            self.assertIs(out, resp)
            kw = rec.call_args.kwargs
            self.assertEqual((kw["channel"], kw["tax_topic"], kw["question_type"]), ("chat", "부가가치세", "절차"))
            q.assert_called_once_with("local-1", "asst_local-1_1", "부가세 신고 기한이 언제예요?")
        copy_context().run(run)

    def test_helper_failure_does_not_block(self):
        resp = _resp(ChatMeta())
        with mock.patch("api.turn_record.fields", side_effect=RuntimeError("boom")), \
                mock.patch("api.rag.store.record_chat_turn") as rec, mock.patch("api.rag.store.record_question") as q:
            out = pipeline._recorded(resp, "local-1", "clinic", "verdict", None, None)
        self.assertIs(out, resp)
        self.assertNotIn("channel", rec.call_args.kwargs)
        q.assert_not_called()


if __name__ == "__main__":
    unittest.main()
