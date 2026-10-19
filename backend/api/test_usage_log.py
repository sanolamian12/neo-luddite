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
        body = {"id": "chatcmpl-1", "model": "solar-pro3-250422",
                "usage": {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}}
        return SimpleNamespace(model="solar-pro3-250422",
                               usage=SimpleNamespace(prompt_tokens=120, completion_tokens=30, total_tokens=150),
                               model_dump=lambda: body)   # SDK 응답 객체처럼


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

    def test_capture_off_by_default(self):
        import os
        import tempfile
        os.environ.pop("API_CALL_CAPTURE_DIR", None)
        with tempfile.TemporaryDirectory() as d, redirect_stdout(io.StringIO()):
            _call("conv-abc", model="solar-pro4", messages=[])
            self.assertEqual(os.listdir(d), [])

    def test_capture_writes_full_record(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            os.environ["API_CALL_CAPTURE_DIR"] = d
            try:
                with redirect_stdout(io.StringIO()):
                    _call("conv-abc", model="solar-pro4", extra_headers={"Authorization": "Bearer up_SECRET"},
                          messages=[{"role": "user", "content": "연봉 5천 소득세"}], temperature=0)
                    _call(None, model="embedding-query", input="질의")
                    with self.assertRaises(TimeoutError):
                        _call("room_r1", fail=True, model="solar-pro4", messages=[])
            finally:
                del os.environ["API_CALL_CAPTURE_DIR"]
            with open(os.path.join(d, usage_log.CAPTURE_FILE), encoding="utf-8") as f:
                raw = f.read()
        chat, emb, err = [json.loads(l) for l in raw.splitlines()]
        req, res = chat["request"], chat["response"]
        self.assertEqual(chat["fn"], "write_advisory")
        self.assertEqual(req["endpoint"], "https://api.upstage.ai/v1/chat/completions")
        self.assertEqual(req["model"], "solar-pro4")
        self.assertEqual(req["body"]["messages"][0]["content"], "연봉 5천 소득세")   # 요청 내용 전체
        self.assertTrue(req["requested_at_kst"].endswith("+09:00"))
        self.assertTrue(res["responded_at_kst"].endswith("+09:00"))
        self.assertLessEqual(req["requested_at_kst"], res["responded_at_kst"])
        self.assertEqual(res["body"]["usage"]["total_tokens"], 150)                   # 응답 본문(토큰)
        self.assertNotIn("SECRET", raw)                                               # 키·헤더는 넣지 않는다
        self.assertNotIn("extra_headers", raw)
        self.assertNotIn("conv-abc", raw)
        self.assertEqual(emb["request"]["endpoint"], "https://api.upstage.ai/v1/embeddings")
        self.assertFalse(err["response"]["ok"])
        self.assertEqual(err["response"]["error"]["type"], "TimeoutError")
        self.assertEqual(err["channel"], "room")

    def test_channels(self):
        self.assertEqual(usage_log.channel("eval-x"), "eval")
        self.assertEqual(usage_log.channel("room_1"), "room")
        self.assertEqual(usage_log.channel("c_1"), "chat")
        self.assertEqual(usage_log.channel(None), "bg")


if __name__ == "__main__":
    unittest.main()
