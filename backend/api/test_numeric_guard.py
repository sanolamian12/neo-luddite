"""날조 수치 가드의 조문 비율 표기 'N분의 M'(E 과제, 10/16) — numeric_guard 회귀 테스트(Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_numeric_guard -v

원문은 10/15 C1(비상장주식 저가양도 — 증권거래세법 §8 '1만분의 35')."""

import unittest

from api import law_select, numeric_guard as G

ART8 = "제8조(세율) ① 증권거래세의 세율은 1만분의 35로 한다. 다만, 2021년 1월 1일부터 2022년 12월 31일까지는 1만분의43으로 한다."


class Fractions(unittest.TestCase):
    def test_values(self):
        for text, pct in (("1만분의 35", 0.35), ("100분의 30", 30.0), ("1천분의 16", 1.6), ("천분의 16", 1.6),
                          ("만분의 35", 0.35), ("1만 분의 35", 0.35), ("1,000분의 5", 0.5), ("1만분의43", 0.43)):
            self.assertEqual(G._tokens(text), [("pct", pct)], text)

    def test_unit_is_not_an_amount(self):
        # '1만' 을 10,000원으로 읽지 않는다
        self.assertNotIn(("won", 10000.0), G._tokens("세율은 1만분의 35입니다."))

    def test_answer_quotes_article(self):
        # 답이 조문 표기를 그대로 옮겨도, % 로 써도 통과(출처 = numeric_view 를 거친 조문 · 원문 둘 다)
        for src in (law_select.numeric_view(ART8), ART8):
            for ans in ("비상장주식 양도의 증권거래세 세율은 1만분의 35입니다.",
                        "비상장주식 양도의 증권거래세 세율은 0.35%입니다.",
                        "세율은 1만분의 35(0.35%)입니다."):
                self.assertEqual(G.unsourced_in(ans, [src], []), [], (ans, src[:20]))

    def test_wrong_rate_still_caught(self):
        self.assertEqual(G.unsourced_in("증권거래세 세율은 0.25%입니다.", [ART8], []), [("pct", 0.25)])
        self.assertEqual(G.unsourced_in("세율은 1만분의 25입니다.", [ART8], []), [("pct", 0.25)])

    def test_incidental_bunui_ignored(self):
        self.assertEqual(G._tokens("나머지 부분의 30"), [])


class ColloquialCheon(unittest.TestCase):
    """Y02-2(10/15 c2): 사용자 '연봉 4천이에요' — 답의 '4,000만원' 이 출처 없는 수치로 빠졌다."""

    def test_user_cheon_is_cheonman(self):
        own = ["신용카드 소득공제 얼마나 써야 받을 수 있어요?", "연봉 4천이에요"]
        self.assertEqual(G.unsourced_in("연봉 4,000만원 기준으로 보면", own, own), [])

    def test_only_from_user_side(self):
        # 근거(남의 사안)의 '4천' 은 넓혀 읽지 않는다
        self.assertEqual(G.unsourced_in("연봉 4,000만원", ["연봉 4천"], []), [("won", 4 * 10**7)])

    def test_explicit_units_unchanged(self):
        for t in ("4천원", "4천 원", "4천만원", "4천5백만원"):
            self.assertEqual(G._COLLOQ_CHEON.findall(t), [], t)

    def test_law_pct_not_operand(self):
        # 25% 는 법령 수 — 산술 피연산자로 쓰지 않는다(9/18 설계). 1,000만원 은 여전히 출처 없음(관찰로 남김)
        own = ["연봉 4천이에요"]
        self.assertEqual(G.unsourced_in("4,000만원의 25%인 1,000만원", own + ["총급여액의 100분의 25"], own),
                         [("won", 10**7)])


if __name__ == "__main__":
    unittest.main()
