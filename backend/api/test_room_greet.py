"""세무사 AI 첫 인사(R3) 문장 테스트 — DB 호출 없음. 실행: cd backend && .venv\Scripts\python.exe -m unittest api.test_room_greet"""

import unittest

from api.room_agent import GREET_QUESTION_MAX, _first_question, greeting_text


class Greeting(unittest.TestCase):
    def test_first_user_question(self):
        payload = {"messages": [{"role": "assistant", "segments": [{"text": "무엇을 도와드릴까요?"}]},
                                {"role": "user", "segments": [{"text": "연봉 5000인데"}, {"text": "소득세 얼마야?"}]}]}
        self.assertEqual(_first_question(payload), "연봉 5000인데 소득세 얼마야?")
        self.assertEqual(_first_question(None), "")

    def test_long_question_is_cut(self):
        q = _first_question({"messages": [{"role": "user", "segments": [{"text": "가" * 300}]}]})
        self.assertEqual(len(q), GREET_QUESTION_MAX + 1)
        self.assertTrue(q.endswith("…"))

    def test_text(self):
        t = greeting_text("윤서진 세무사", "병의원 상담입니다. 가상 인물입니다.", "연봉 5000인데 소득세 얼마야?")
        self.assertTrue(t.startswith("안녕하세요, 윤서진 세무사의 AI입니다."))
        self.assertIn("「연봉 5000인데 소득세 얼마야?」", t)
        self.assertIn("가상 인물입니다.", t)
        self.assertNotIn("「」", greeting_text("윤서진 세무사", "", ""))

    def test_name_only_gets_suffix(self):
        self.assertTrue(greeting_text("윤서진", "", "").startswith("안녕하세요, 윤서진 세무사의 AI입니다."))


if __name__ == "__main__":
    unittest.main()
