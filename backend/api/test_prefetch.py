"""첫 턴 미리 시작(LAW_PREFETCH, 10/27) — pipeline._start_prefetch · _use_prefetch · _law_step(pre_picks) · _issue_gate(pre_fits).
Solar·DB 호출 없음(검색기·select·쟁점 판단을 가짜로 바꾼다).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_prefetch -v"""

import os
import unittest
from types import SimpleNamespace
from unittest import mock

from api import law_select, llm, pipeline, upstage_gate
from api.schema import Message, Segment

ON = mock.patch.dict(os.environ, {"LAW_PREFETCH": "on", "KB3_ISSUE_GATE": "on"})
Q = "간이과세자 기준이 뭔가요?"


def user(text, order=0):
    return Message(id=f"u{order}", role="user", order=order, segments=[Segment(id=f"u{order}s", text=text, type="question")])


def passage(pid, corpus="kb3_qna"):
    return SimpleNamespace(id=pid, corpus=corpus, source_kind="qna", score=0.5, case_refs=[], content="")


class FakeRetriever:
    calls = 0

    def retrieve(self, q, k=5, occupation="clinic"):
        FakeRetriever.calls += 1
        return [passage("a"), passage("b")]


def fakes(test):
    FakeRetriever.calls = 0
    calls = {"select": 0, "judge": 0}

    def select(q, cands):
        calls["select"] += 1
        return []

    def judge(q, kb3):
        calls["judge"] += 1
        return {"a": "same", "b": "different"}

    patches = [mock.patch.object(pipeline, "get_retriever", lambda **kw: FakeRetriever()),
               mock.patch.object(law_select, "candidates", lambda q, ps: ["c"]),
               mock.patch.object(law_select, "select", select),
               mock.patch.object(law_select, "enabled", lambda: True),
               mock.patch.object(llm, "judge_issue_fit", judge),
               mock.patch.object(llm, "KB3_CORPORA", ("kb3_qna",)),
               mock.patch.object(upstage_gate, "stats", lambda: {"active": 0, "waiting": 0})]
    for p in patches:
        p.start()
        test.addCleanup(p.stop)
    return calls


def start(test, history=()):
    """미리 시작 + 테스트 끝에 스레드가 다 끝나길 기다린다(남은 스레드가 다음 테스트의 가짜 함수를 부르지 않게)."""
    pf = pipeline._start_prefetch(list(history), Q, None, None, None)
    if pf is not None:
        test.addCleanup(lambda: [f.exception() for f in (pf.passages, pf.picks, pf.fits) if f is not None])
    return pf


class Start(unittest.TestCase):
    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LAW_PREFETCH", None)
            self.assertIsNone(pipeline._start_prefetch([], Q, None, None, None))

    @ON
    def test_first_turn_only(self):
        fakes(self)
        self.assertIsNotNone(start(self))
        self.assertIsNone(pipeline._start_prefetch([user("앞 질문")], Q, None, None, None))

    @ON
    def test_busy_gate_skips(self):
        fakes(self)
        with mock.patch.object(upstage_gate, "stats", lambda: {"active": 2, "waiting": 0}):
            self.assertIsNone(pipeline._start_prefetch([], Q, None, None, None))
        with mock.patch.object(upstage_gate, "stats", lambda: {"active": 0, "waiting": 1}):
            self.assertIsNone(pipeline._start_prefetch([], Q, None, None, None))
        with mock.patch.object(upstage_gate, "stats", lambda: {"active": 1, "waiting": 0}):
            self.assertIsNone(pipeline._start_prefetch([], Q, None, None, None))

    @ON
    def test_other_turn_in_flight_skips(self):
        fakes(self)
        with mock.patch.object(pipeline, "_TURNS", [2]):
            self.assertIsNone(pipeline._start_prefetch([], Q, None, None, None))
        with mock.patch.object(pipeline, "_TURNS", [1]):                  # 이 턴 혼자
            self.assertIsNotNone(start(self))


class Use(unittest.TestCase):
    @ON
    def test_same_query_reuses_everything(self):
        calls = fakes(self)
        pf = start(self)
        ps, pre = pipeline._use_prefetch(pf, Q, FakeRetriever())
        self.assertEqual([p.id for p in ps], ["a", "b"])
        kept, dropped = pipeline._issue_gate(Q, ps, {}, pre.fits)
        self.assertEqual([p.id for p in kept], ["a"])
        self.assertEqual(len(dropped), 1)
        pipeline._law_step(Q, ps, [], pre_picks=pre.picks)
        self.assertEqual((calls["select"], calls["judge"], FakeRetriever.calls), (1, 1, 1))   # 다시 부르지 않음

    @ON
    def test_different_query_discards(self):
        fakes(self)
        pf = start(self)
        self.assertEqual(pipeline._use_prefetch(pf, "다시 쓴 질의", FakeRetriever()), (None, None))
        self.assertEqual(pipeline._use_prefetch(None, Q, FakeRetriever()), (None, None))

    @ON
    def test_failed_prefetch_falls_back(self):
        calls = fakes(self)
        pf = start(self)
        pf.fits.result()
        broken = mock.Mock()
        broken.result.side_effect = RuntimeError("시간 초과")
        kept, _ = pipeline._issue_gate(Q, [passage("a"), passage("b")], {}, broken)
        self.assertEqual([p.id for p in kept], ["a"])
        self.assertEqual(calls["judge"], 2)                                 # 실패분은 그 자리에서 다시 부름


if __name__ == "__main__":
    unittest.main()
