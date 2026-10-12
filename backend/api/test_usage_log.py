"""Upstage 사용 로그(10/12) 테스트 — 네트워크·DB 없음. 실행: cd backend && .venv\Scripts\python.exe -m unittest api.test_usage_log"""

import io
import json
import unittest
from contextlib import redirect_stdout
from contextvars import copy_context
from types import SimpleNamespace

from api import llm, usage_log


class _FakeCompletions:
    def __init__(self, fail=False):
        self.fail = fail

    def create(self, **kwargs):
        if self.fail:
            raise TimeoutError("멈춤")
        return SimpleNamespace(model="solar-pro3-250422",
                               usage=SimpleNamespace(prompt_tokens=120, completion_tokens=30, total_tokens=150))


def _lines(out: str) -> list[dict]:
    return [json.loads(l[len(usage_log.PREFIX):]) for l in out.splitlines() if l.startswith(usage_log.PREFIX)]


def _call(conv, fail=False, **kwargs):
    def run():
        usage_log.bind(conv)
        client = llm._Gated(SimpleNamespace(completions=_FakeCompletions(fail)), "write_advisory")
        return client.completions.create(**kwargs)
    return copy_context().run(run)


class UsageLog(unittest.TestCase):
    def test_chat_call_line(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            _call("conv-abc", model="solar-pro3", messages=[{"role": "user", "content": "연봉 5천 소득세 비밀내용"}])
        [rec] = _lines(buf.getvalue())
        self.assertEqual(rec["fn"], "write_advisory")
        self.assertEqual(rec["kind"], "chat")
        self.assertEqual(rec["model"], "solar-pro3-250422")
        self.assertEqual(rec["ch"], "chat")
        self.assertEqual(rec["conv"], usage_log.conv_hash("conv-abc"))
        self.assertEqual((rec["prompt_tokens"], rec["completion_tokens"], rec["total_tokens"]), (120, 30, 150))
        self.assertTrue(rec["ok"])
        self.assertNotIn("비밀내용", buf.getvalue())   # 본문은 남기지 않는다
        self.assertNotIn("conv-abc", buf.getvalue())   # 대화 id 는 해시로만

    def test_error_is_logged_and_reraised(self):
        buf = io.StringIO()
        with redirect_stdout(buf), self.assertRaises(TimeoutError):
            _call("room_r1", fail=True, model="solar-pro3", messages=[])
        [rec] = _lines(buf.getvalue())
        self.assertFalse(rec["ok"])
        self.assertEqual(rec["err"], "TimeoutError")
        self.assertEqual(rec["ch"], "room")

    def test_embed_kind_and_background_channel(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            _call(None, model="embedding-query", input="질의")
        [rec] = _lines(buf.getvalue())
        self.assertEqual(rec["kind"], "embed")
        self.assertEqual(rec["ch"], "bg")
        self.assertIsNone(rec["conv"])

    def test_off_switch(self):
        import os
        os.environ["UPSTAGE_CALL_LOG"] = "off"
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                _call("conv-abc", model="solar-pro3", messages=[])
            self.assertEqual(_lines(buf.getvalue()), [])
        finally:
            del os.environ["UPSTAGE_CALL_LOG"]

    def test_channels(self):
        self.assertEqual(usage_log.channel("eval-x"), "eval")
        self.assertEqual(usage_log.channel("room_1"), "room")
        self.assertEqual(usage_log.channel("c_1"), "chat")
        self.assertEqual(usage_log.channel(None), "bg")


if __name__ == "__main__":
    unittest.main()
