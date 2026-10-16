"""3자 방 마감(A7, 10/16) — 방 history 정리 · 방 답 길이 상한 회귀 테스트(Solar·DB 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_room_agent -v
"""
import unittest

from api import llm, room_agent
from api.schema import ChatMeta, ChatResponse, Message, Segment


def _resp(texts, refs=None):
    segs = [Segment(id=f"m_s{i}", text=t, type="application") for i, t in enumerate(texts)]
    return ChatResponse(message=Message(id="m", role="assistant", order=1, segments=segs),
                        meta=ChatMeta(ragCaseRefs=refs or []))


class HistoryTest(unittest.TestCase):
    def test_agent_reply_drops_refs_and_verdict(self):
        body = "판정: 부인\n\n회식비 80만원은 접대비로 보기 어렵습니다.\n\n참고 자료: kb3:123, 소득세법 제27조"
        self.assertEqual(room_agent._agent_for_history(body), "회식비 80만원은 접대비로 보기 어렵습니다.")

    def test_long_agent_reply_head_tail(self):
        body = "가" * 400 + "중간80만원" + "나" * 400
        out = room_agent._agent_for_history(body)
        self.assertNotIn("중간80만원", out)
        self.assertTrue(out.startswith("가") and out.endswith("나"))

    def test_roles_and_limit(self):
        rows = [(f"r{i}", "user", f"질문{i}") for i in range(15)] + [("e", "auditor", "80만원이면 접대비입니다")]
        h = room_agent._history(rows, "user")
        self.assertEqual(len(h), room_agent.HISTORY_LIMIT)
        self.assertEqual(h[-1].role, "assistant")
        self.assertTrue(h[-1].segments[0].text.startswith("[세무사 직접 답변]"))
        h2 = room_agent._history(rows, "auditor")
        self.assertEqual(h2[-1].role, "user")
        self.assertTrue(h2[-1].segments[0].text.startswith("[세무사]"))

    def test_room_context_brief(self):
        for role in ("user", "auditor"):
            principles, _ = room_agent.agent_profile(None, role)
            self.assertIn("말풍선", principles)
        principles, _ = room_agent.agent_profile(None, None)
        self.assertIsNone(principles)


class LengthTest(unittest.TestCase):
    def test_segments_cap_keeps_last(self):
        n = room_agent.ROOM_SEGMENTS_MAX
        text = room_agent.to_text(_resp([f"문장{i}입니다." for i in range(15)]))
        self.assertIn(f"문장{n - 2}입니다.", text)
        self.assertNotIn(f"문장{n - 1}입니다.", text)
        self.assertTrue(text.endswith("문장14입니다."))

    def test_text_cap_drops_middle_keeps_last_and_refs(self):
        paras = ["결론입니다. " * 20] + [f"■ 근거{i}. " + "가나다라마바사아자차. " * 20 for i in range(4)] + ["확인할 점: 공사 내역."]
        text = room_agent.to_text(_resp(paras, refs=["kb3:1"]))
        body, _, tail = text.rpartition("\n\n참고 자료: ")
        self.assertLessEqual(len(body), room_agent.ROOM_TEXT_MAX)
        self.assertTrue(body.startswith("결론입니다."))
        self.assertTrue(body.endswith("확인할 점: 공사 내역."))
        self.assertNotIn("(이하 생략)", body)
        self.assertEqual(tail, "kb3:1")

    def test_text_cap_falls_back_to_cut(self):
        text = room_agent.to_text(_resp(["가나다라마바사아자차. " * 60] * 3))
        self.assertLessEqual(len(text), room_agent.ROOM_TEXT_MAX)
        self.assertIn("(이하 생략)", text)

    def test_write_cap_only_in_context(self):
        self.assertEqual(llm.write_max_tokens(), llm.WRITE_MAX_TOKENS)
        tok = llm.WRITE_TOKENS_CAP.set(room_agent.ROOM_WRITE_MAX_TOKENS)
        try:
            self.assertEqual(llm.write_max_tokens(), min(llm.WRITE_MAX_TOKENS, room_agent.ROOM_WRITE_MAX_TOKENS))
        finally:
            llm.WRITE_TOKENS_CAP.reset(tok)
        self.assertEqual(llm.write_max_tokens(), llm.WRITE_MAX_TOKENS)


if __name__ == "__main__":
    unittest.main()
