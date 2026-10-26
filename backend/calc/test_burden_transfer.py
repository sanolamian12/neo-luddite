"""부담부증여(10/26 밤) — 증여세 채무 공제(상증법 §47①) · 증여자 양도세(calc.burden_transfer) · 슬롯·추출 단위 테스트. Solar·DB 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_burden_transfer -v

기대값은 손 계산(시행령 §159 양도가액 = 채무 · 취득가액 × 채무 ÷ 증여가액 → §95② 표 1 → §103 250만 → §55① 기본세율)."""

import unittest

from calc import burden_transfer as bt
from calc import gift_slots, gift_view
from calc.gift_extract import read_slots
from calc.stock_transfer import EOK, gift_tax


class GiftDebt(unittest.TestCase):
    def test_debt_reduces_taxable(self):
        g = gift_tax(10 * EOK, "parent", debt=3 * EOK)             # 7억 − 5천 = 6.5억 → 9천 + 1.5억×30% = 1.35억 → 3%
        self.assertEqual(g.tax, 130_950_000)
        self.assertEqual([s.key for s in g.steps][:3], ["gift_value", "gift_debt", "gift_taxable"])
        self.assertIn(("상속세 및 증여세법", "47"), g.basis)

    def test_no_debt_unchanged(self):
        self.assertEqual(gift_tax(10 * EOK, "parent").tax, 218_250_000)
        self.assertEqual([s.key for s in gift_tax(3 * EOK, "parent").steps],
                         ["gift_value", "gift_deduction", "gift_base", "gift_computed", "filing_credit", "gift_tax"])

    def test_debt_capped_at_value(self):
        g = gift_tax(3 * EOK, "parent", debt=5 * EOK)
        self.assertFalse(g.applies)
        self.assertEqual(next(s for s in g.steps if s.key == "gift_debt").amount, 3 * EOK)


class Transfer(unittest.TestCase):
    def test_long_held_apartment(self):
        cg, lt = bt.burden_transfer(9 * EOK, 4 * EOK, 3 * EOK, 10, house=True, one_house=False)
        amt = {s.key: s.amount for s in cg.steps}
        self.assertEqual(amt["bg_value"], 4 * EOK)
        self.assertEqual(amt["bg_acq"], 133_333_333)
        self.assertEqual(amt["bg_ltd"], 53_333_333)                # 20%(10년)
        self.assertEqual(amt["bg_base"], 210_833_334)
        self.assertEqual(cg.tax, 60_176_666)                       # 3,706만 + (과표 − 1.5억) × 38%
        self.assertEqual(lt.tax, 6_017_666)

    def test_shop_year_given(self):
        cg, _ = bt.burden_transfer(8 * EOK, 2 * EOK, 2 * EOK, 11, house=False)
        self.assertEqual(cg.tax, 24_635_000)                       # 22% 공제 · 과표 1.145억 → 35% 구간

    def test_short_holding_house_70(self):
        cg, _ = bt.burden_transfer(5 * EOK, 2 * EOK, 4 * EOK, 0, house=True, one_house=False)
        base = next(s for s in cg.steps if s.key == "bg_base").amount
        self.assertEqual(cg.tax, base * 70 // 100)
        self.assertIn("70%", cg.steps[-1].note)

    def test_lt_rate_table(self):
        self.assertEqual([bt.lt_rate(y)[0] for y in (None, 2, 3, 4, 14, 15, 30)], [0, 0, 6, 8, 28, 30, 30])

    def test_exempt_case(self):
        cg, lt = bt.burden_transfer(9 * EOK, 4 * EOK, 3 * EOK, 10, house=True, one_house=True)
        self.assertFalse(cg.applies)
        self.assertEqual(cg.tax + lt.tax, 0)
        self.assertFalse(bt.exempt(13 * EOK, True, True))           # 고가주택
        self.assertFalse(bt.exempt(9 * EOK, True, True, 1))         # 보유 2년 미만
        self.assertFalse(bt.exempt(9 * EOK, False, True))           # 상가

    def test_no_gain(self):
        cg, lt = bt.burden_transfer(5 * EOK, 2 * EOK, 6 * EOK, 5, house=False)
        self.assertFalse(cg.applies)
        self.assertFalse(lt.applies)


class Slots(unittest.TestCase):
    def test_unknown_house_count_two_cases(self):
        f = gift_slots.fill({"value": 6 * EOK, "debt": 2 * EOK, "acquisition": 2 * EOK, "years": 14, "relation": "child"})
        b = gift_slots.compute_burden(f)
        self.assertTrue(b.exempt_case)
        self.assertIsNotNone(b.cg)
        self.assertIn("1세대 1주택 비과세(12억원 이하)에 해당하면 0원", gift_view.headline(f, gift_slots.compute(f), b))
        self.assertIn("one_house", f.assumed)

    def test_no_acquisition(self):
        f = gift_slots.fill({"value": 6 * EOK, "debt": 2 * EOK, "relation": "child", "house": False})
        b = gift_slots.compute_burden(f)
        self.assertTrue(b.no_acq)
        self.assertIsNone(b.cg)
        self.assertIn("산 가격", gift_slots.invite(f, gift_slots.compute(f)))

    def test_high_house_one_house_not_computed(self):
        f = gift_slots.fill({"value": 15 * EOK, "debt": 5 * EOK, "acquisition": 5 * EOK, "relation": "child",
                             "one_house": True})
        b = gift_slots.compute_burden(f)
        self.assertTrue(b.high_house)
        self.assertIsNone(b.cg)

    def test_debt_word_without_amount_asks(self):
        f = gift_slots.fill({"value": 7 * EOK, "debt_said": True, "relation": "child"})
        self.assertTrue(f.missing)
        self.assertTrue(gift_slots.missing_question(f).startswith(gift_slots.MISSING_HEAD))
        self.assertIn("채무", gift_slots.missing_question(f))

    def test_compare_line(self):
        f = gift_slots.fill({"value": 10 * EOK, "debt": 3 * EOK, "relation": "child"})
        sec = gift_slots.compute(f)
        self.assertIn("218,250,000원", gift_view.compare_line(f, sec, gift_slots.compute_burden(f)))


class Extract(unittest.TestCase):
    def test_debt_and_value(self):
        self.assertEqual(read_slots(["전세 3억 낀 시가 10억 아파트를 아들에게 증여하면 증여세 얼마예요?"]),
                         {"value": 10 * EOK, "debt": 3 * EOK, "house": True, "relation": "child"})
        ex = read_slots(["대출 2억이 남은 집(시가 6억)을 딸에게 증여하면 세금이 얼마나 나와요?"])
        self.assertEqual((ex["value"], ex["debt"]), (6 * EOK, 2 * EOK))

    def test_donor_details(self):
        ex = read_slots(["아버지가 10년 전에 3억에 산 아파트(시가 9억, 전세 4억)를 저한테 부담부증여하면 세금 얼마예요? "
                         "아버지는 집이 한 채예요"])
        self.assertEqual((ex["acquisition"], ex["years"], ex["one_house"], ex["relation"]),
                         (3 * EOK, 10, True, "child"))
        ex = read_slots(["2015년에 2억에 산 상가(시가 8억, 보증금 2억)를 아들에게 부담부증여하면 세금 계산해 주세요"])
        self.assertEqual((ex["years"], ex["house"], ex["acquisition"]), (11, False, 2 * EOK))
        ex = read_slots(["아버지가 3억에 사셨고 10년 전에 사신 거예요. 집이 두 채예요"])
        self.assertEqual((ex["acquisition"], ex["years"], ex["one_house"]), (3 * EOK, 10, False))

    def test_debt_word_only(self):
        ex = read_slots(["부담부증여로 아파트 시가 7억을 딸에게 주면 얼마예요?"])
        self.assertTrue(ex["debt_said"])
        self.assertNotIn("debt", ex)

    def test_giver_subject_long_phrase(self):
        ex = read_slots(["부모님이 시가 5억 집을 증여해주시면 증여세 얼마예요? 전세 2억이에요"])
        self.assertEqual((ex["relation"], ex["value"], ex["debt"]), ("child", 5 * EOK, 2 * EOK))

    def test_plain_gift_unchanged(self):
        self.assertEqual(read_slots(["아들에게 현금 1억 증여하면 증여세 얼마예요?"]), {"value": 1 * EOK, "relation": "child"})
        self.assertEqual(read_slots(["5년 전에 아버지께 1억을 증여받았는데, 이번에 또 1억을 받으면 증여세가 얼마예요?"]),
                         {"value": 1 * EOK, "prior_gifts": 1 * EOK, "relation": "child"})


if __name__ == "__main__":
    unittest.main()
