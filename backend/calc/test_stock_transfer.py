"""주식 양도 복합 사안 계산(E단계 1차) 단위 테스트 — Solar·DB 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_stock_transfer -v

기대값 출처: 세무사 피드백 10/14 캡처 사례(비상장 중소기업 65%, 시가 10억·취득가 1억 주식을 성년 아들에게 3억에 양도) —
설계 부록 B 에서 현행 원문으로 재현한 값. 테스트 기대값으로만 쓴다(프롬프트에 넣지 않음)."""

import unittest

from calc.stock_transfer import (EOK, MAN, StockTransferInput, calculate, gift_tax, major_shareholder,
                                 unfair_transfer)

CAPTURE = StockTransferInput(market_value=10 * EOK, price=3 * EOK, acquisition=1 * EOK, market=None, size="sme",
                             share_pct=65, relation="child")


class Capture(unittest.TestCase):
    def setUp(self):
        self.r = calculate(CAPTURE)

    def test_securities_tax_on_market_value(self):
        s = self.r.section("securities_tax")
        self.assertEqual(s.tax, 3_500_000)                      # 10억 × 1만분의 35 (저가 양도 인정 → 시가액)
        self.assertEqual(s.steps[0].amount, 10 * EOK)

    def test_capital_gains_with_local(self):
        self.assertTrue(self.r.major and self.r.unfair)
        cg, lt = self.r.section("capital_gains"), self.r.section("local_tax")
        self.assertEqual(cg.steps[0].amount, 10 * EOK)          # 양도가액 = 시가(§167④)
        self.assertEqual(cg.steps[4].amount, 894_000_000)   # 과세표준
        self.assertEqual(cg.tax, 208_500_000)                   # 6천만 + 5.94억 × 25%
        self.assertEqual(cg.tax + lt.tax, 229_350_000)

    def test_gift_tax(self):
        g = self.r.section("gift_tax")
        self.assertEqual(g.taxpayer, "양수자")
        self.assertEqual(next(s for s in g.steps if s.key == "gift_value").amount, 4 * EOK)   # 7억 − min(3억, 3억)
        self.assertEqual(next(s for s in g.steps if s.key == "gift_deduction").amount, 5_000 * MAN)
        self.assertEqual(g.tax, 58_200_000)

    def test_total(self):
        self.assertEqual(self.r.total, 3_500_000 + 229_350_000 + 58_200_000)


class Major(unittest.TestCase):
    def test_listed_thresholds(self):
        f = lambda **kw: major_shareholder(StockTransferInput(1, 1, 0, **kw))[0]
        self.assertTrue(f(market="kospi", share_pct=1))
        self.assertFalse(f(market="kosdaq", share_pct=1.5))
        self.assertTrue(f(market="kosdaq", holding_value=50 * EOK))
        self.assertTrue(f(market="konex", share_pct=4))

    def test_unlisted_and_unknown(self):
        self.assertTrue(major_shareholder(StockTransferInput(1, 1, 0, share_pct=4))[0])
        self.assertTrue(major_shareholder(StockTransferInput(1, 1, 0, holding_value=10 * EOK))[0])
        self.assertFalse(major_shareholder(StockTransferInput(1, 1, 0, holding_value=10 * EOK, venture_kotc=True,
                                                              market="kotc"))[0])
        yes, why, _ = major_shareholder(StockTransferInput(1, 1, 0))
        self.assertFalse(yes)
        self.assertIn("몰라", why)


class Rates(unittest.TestCase):
    def test_minor_sme_off_market_unlisted(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN, share_pct=1))
        # 차익 5천만 − 증권거래세 35만 − 250만 = 47,150,000 × 10%
        self.assertEqual(r.section("capital_gains").tax, 4_715_000)
        self.assertEqual(r.section("securities_tax").tax, 350_000)
        self.assertFalse(any(s.key == "gift_tax" for s in r.sections))

    def test_minor_large_20(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN, size="large",
                                         share_pct=1))
        self.assertEqual(r.section("capital_gains").tax, 9_430_000)

    def test_major_short_non_sme_30(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN, size="large",
                                         share_pct=10, holding_months=6))
        self.assertEqual(r.section("capital_gains").tax, 14_145_000)

    def test_major_short_sme_bracket(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN,
                                         share_pct=10, holding_months=6))
        self.assertEqual(r.section("capital_gains").tax, 9_430_000)

    def test_listed_minor_on_market_not_taxable(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN,
                                         market="kospi", on_market=True, share_pct=0.1))
        self.assertFalse(r.section("capital_gains").applies)
        self.assertEqual(r.section("capital_gains").tax, 0)
        self.assertEqual(r.section("securities_tax").tax, 50_000)          # 유가증권시장 1만분의 5
        self.assertEqual(r.total, 50_000)

    def test_kosdaq_rate_and_kotc_exempt(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=0, market="kosdaq",
                                         on_market=True, share_pct=0.1))
        self.assertEqual(r.section("securities_tax").tax, 200_000)         # 1만분의 20
        k = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=0, market="kotc",
                                         share_pct=1))
        self.assertFalse(k.section("capital_gains").applies)
        self.assertEqual(k.section("securities_tax").tax, 200_000)

    def test_listed_off_market_base_rate(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=0, market="kospi",
                                         share_pct=0.1))
        self.assertTrue(r.section("capital_gains").applies)                 # 소액주주 장외 = 과세
        self.assertEqual(r.section("securities_tax").tax, 350_000)


class Unfair(unittest.TestCase):
    def test_gap_threshold_unlisted(self):
        # 시가 10억 · 5% = 5천만 — 4천만 낮으면 대상 아님, 6천만 낮으면 대상
        self.assertFalse(unfair_transfer(StockTransferInput(10 * EOK, 96_000 * MAN, 0, relation="child"))[0])
        self.assertTrue(unfair_transfer(StockTransferInput(10 * EOK, 94_000 * MAN, 0, relation="child"))[0])
        self.assertFalse(unfair_transfer(StockTransferInput(10 * EOK, 3 * EOK, 0, relation="unrelated"))[0])

    def test_listed_no_threshold(self):
        self.assertTrue(unfair_transfer(StockTransferInput(10 * EOK, 99_000 * MAN, 0, market="kospi",
                                                           relation="child"))[0])


class Gift(unittest.TestCase):
    def test_general_gift_brackets(self):
        # 직계존속 → 성년 자녀 3억: 3억 − 5천 = 2.5억 → 1천만 + 1.5억×20% = 4천만 → 3% 공제 = 38,800,000
        self.assertEqual(gift_tax(3 * EOK, "parent").tax, 38_800_000)
        # 미성년 공제 2천만
        self.assertEqual(gift_tax(3 * EOK, "parent", minor=True).steps[1].amount, 2_000 * MAN)

    def test_generation_skip_and_min(self):
        g = gift_tax(3 * EOK, "grandchild", generation_skip=True)
        # 산출 4천만 + 30% 1,200만 = 5,200만 → 3% 156만 → 50,440,000
        self.assertEqual(g.tax, 50_440_000)
        self.assertFalse(gift_tax(5_030 * MAN, "parent").applies)          # 과표 30만 < 50만

    def test_prior_deduction_used(self):
        self.assertEqual(gift_tax(1 * EOK, "parent", prior_used=3_000 * MAN).steps[1].amount, 2_000 * MAN)

    def test_grandparent_minor_deduction(self):
        # §53 2호 단서: 직계존속(조부모 포함)에게서 받는 미성년자 2천만 — 3억 − 2천 = 2.8억 → 4,600만 + 30% → 5,980만 → 3% → 58,006,000
        g = gift_tax(3 * EOK, "grandchild", minor=True, generation_skip=True)
        self.assertEqual(g.steps[1].amount, 2_000 * MAN)
        self.assertEqual(g.tax, 58_006_000)

    def test_defaults_keep_steps(self):
        # 10/26 확장 인자 기본값이면 종전 단계 그대로(주식 §35 경로가 같은 함수를 쓴다)
        self.assertEqual([s.key for s in gift_tax(3 * EOK, "parent").steps],
                         ["gift_value", "gift_deduction", "gift_base", "gift_computed", "filing_credit", "gift_tax"])
        self.assertEqual(gift_tax(3 * EOK, "parent").basis, gift_tax(3 * EOK, "parent", prior_gifts=900 * MAN).basis)

    def test_marriage_deduction(self):
        # §53의2: 결혼 자금 1억(부모) = 5천 + 남은 5천 → 과표 0
        g = gift_tax(1 * EOK, "parent", marriage="marriage")
        self.assertFalse(g.applies)
        self.assertEqual(next(s for s in g.steps if s.key == "gift_marriage").amount, 5_000 * MAN)
        # 2억: 2억 − 5천 − 1억 = 5천 → 500만 → 3% → 4,850,000
        self.assertEqual(gift_tax(2 * EOK, "parent", marriage="marriage").tax, 4_850_000)
        self.assertEqual(gift_tax(2 * EOK, "grandchild", marriage="birth").steps[2].amount, 1 * EOK)
        # 배우자에게서 받은 증여엔 없음
        self.assertFalse(any(s.key == "gift_marriage" for s in gift_tax(7 * EOK, "spouse", marriage="marriage").steps))
        # 이미 7천 공제: 3억 − 5천 − 3천 = 2.2억 → 1천만 + 1.2억×20% = 3,400만 → 3% → 32,980,000
        self.assertEqual(gift_tax(3 * EOK, "parent", marriage="marriage", marriage_used=7_000 * MAN).tax, 32_980_000)

    def test_ten_year_sum(self):
        # 이번 1억 + 5년 전 1억(부모): 과세가액 2억 − 5천 = 1.5억 → 2천만 · 앞선 과표 5천 → 500만(한도 666만) →
        # (2천만 − 500만)×3% = 45만 → 14,550,000
        g = gift_tax(1 * EOK, "parent", prior_gifts=1 * EOK)
        self.assertEqual(g.tax, 14_550_000)
        self.assertEqual(next(s for s in g.steps if s.key == "gift_taxable").amount, 2 * EOK)
        self.assertEqual(next(s for s in g.steps if s.key == "prior_credit").amount, 500 * MAN)
        # 앞선 세액을 알면 그것(한도 안) — 300만 → (2천만 − 300만)×3% = 51만 → 16,490,000
        self.assertEqual(gift_tax(1 * EOK, "parent", prior_gifts=1 * EOK, prior_tax=300 * MAN).tax, 16_490_000)
        # 한도: 앞선 세액 1천만이어도 산출세액 × 5천/1.5억 = 6,666,666
        self.assertEqual(next(s for s in gift_tax(1 * EOK, "parent", prior_gifts=1 * EOK, prior_tax=1_000 * MAN).steps
                              if s.key == "prior_credit").amount, 6_666_666)
        # 1천만 미만은 가산하지 않음(§47②)
        self.assertEqual(gift_tax(1 * EOK, "parent", prior_gifts=900 * MAN).tax, gift_tax(1 * EOK, "parent").tax)
        # 조부모 + 10년 합산(10/26 밤, 시행령 §46의3②) — 할증 = 산출세액 × 30% − 종전 할증(추정 500만 × 30%)
        g = gift_tax(3 * EOK, "grandchild", generation_skip=True, prior_gifts=1 * EOK)
        self.assertEqual(next(s for s in g.steps if s.key == "gen_skip").amount, 16_500_000)
        self.assertEqual(g.tax, 69_355_000)
        # 두 번 나눠 낸 세액 합 = 한 번에 4억 받았을 때(종전 할증·납부세액공제가 맞물림)
        first = gift_tax(1 * EOK, "grandchild", generation_skip=True).tax
        self.assertEqual(first + g.tax, gift_tax(4 * EOK, "grandchild", generation_skip=True).tax)
        self.assertIn(("상속세 및 증여세법 시행령", "46의3"), next(s for s in g.steps if s.key == "gen_skip").basis)

    def test_unrelated_low_price(self):
        r = calculate(StockTransferInput(market_value=20 * EOK, price=10 * EOK, acquisition=0, share_pct=1))
        g = r.section("gift_tax")
        self.assertEqual(next(s for s in g.steps if s.key == "gift_value").amount, 7 * EOK)   # 10억 − 3억
        j = calculate(StockTransferInput(market_value=20 * EOK, price=10 * EOK, acquisition=0, share_pct=1,
                                         justified=True))
        self.assertFalse(j.section("gift_tax").applies)

    def test_high_price_gift_to_seller(self):
        r = calculate(StockTransferInput(market_value=5 * EOK, price=8 * EOK, acquisition=1 * EOK, share_pct=10,
                                         relation="parent"))
        g = r.section("gift_tax")
        self.assertEqual(g.taxpayer, "양도자")
        # 차액 3억 − min(1.5억, 3억) = 1.5억, 양도자(자녀)가 부모(양수자)에게서 받은 이익 → 직계존속 공제 5천만
        self.assertEqual(next(s for s in g.steps if s.key == "gift_value").amount, 150_000_000)
        self.assertEqual(next(s for s in g.steps if s.key == "gift_deduction").amount, 5_000 * MAN)

    def test_listed_on_market_no_35(self):
        r = calculate(StockTransferInput(market_value=10 * EOK, price=5 * EOK, acquisition=0, market="kospi",
                                         on_market=True, share_pct=0.1, relation="child"))
        self.assertFalse(r.section("gift_tax").applies)


if __name__ == "__main__":
    unittest.main()
