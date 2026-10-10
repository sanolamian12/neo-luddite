"""
calc.income_tax 단위 테스트 — 실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_income_tax -v

기대값은 조문 원문에서 손으로 계산했다(모듈 코드를 다시 부르지 않는다). 대조 출처:
  소득세법(법률 제21221호, 시행 2026.7.1) — §47① 표(PDF 29쪽) · §55① 표(35쪽) · §59① 표(38쪽)는 원본 PDF,
  §50①·§51①·§59②·§59의2①·§59의4⑨1·§14②·§15 는 laws.articles 현행 본문. 지방세법 §103의13(10/100).
  4대보험: 국민연금 4.75%·기준소득월액 상한 637만(2026.1~6)/659만(2026.7~) — 국민연금공단,
  건강 3.595%·장기요양 0.9448/7.19 — 보건복지부·건보공단, 고용 0.9% — 보험료징수법 시행령 §12.
국세청 홈택스 모의계산과의 교차 확인은 아직 하지 않았다(사용자 확인 대기).
"""

import unittest

from calc.income_tax import (
    IncomeTaxInput,
    basic_tax,
    calculate,
    child_credit,
    earned_income_credit,
    earned_income_deduction,
    estimate_social_insurance,
)


class TableTranscription(unittest.TestCase):
    """§55① 표의 누진 기본세액은 앞 구간 세율로 다시 계산한 값과 같아야 한다 — 옮겨 적기 오류 검사."""

    def test_tax_bracket_bases_are_consistent(self):
        self.assertEqual(basic_tax(14_000_000), 840_000)                          # 1,400만 × 6%
        self.assertEqual(basic_tax(50_000_000), 840_000 + 36_000_000 * 15 // 100)  # = 624만(표)
        self.assertEqual(basic_tax(50_000_000), 6_240_000)
        self.assertEqual(basic_tax(88_000_000), 15_360_000)     # 624만 + 3,800만 × 24% = 1,536만(표)
        self.assertEqual(basic_tax(150_000_000), 37_060_000)    # 1,536만 + 6,200만 × 35% = 3,706만(표)
        self.assertEqual(basic_tax(300_000_000), 94_060_000)    # 3,706만 + 1.5억 × 38% = 9,406만(표)
        self.assertEqual(basic_tax(500_000_000), 174_060_000)   # 9,406만 + 2억 × 40% = 1억7,406만(표)
        self.assertEqual(basic_tax(1_000_000_000), 384_060_000) # 1억7,406만 + 5억 × 42% = 3억8,406만(표)
        self.assertEqual(basic_tax(0), 0)

    def test_earned_deduction_bases_are_consistent(self):
        self.assertEqual(earned_income_deduction(5_000_000), 3_500_000)     # 70% = 350만(표)
        self.assertEqual(earned_income_deduction(15_000_000), 7_500_000)    # 350만 + 1,000만 × 40% = 750만(표)
        self.assertEqual(earned_income_deduction(45_000_000), 12_000_000)   # 750만 + 3,000만 × 15% = 1,200만(표)
        self.assertEqual(earned_income_deduction(100_000_000), 14_750_000)  # 1,200만 + 5,500만 × 5% = 1,475만(표)

    def test_earned_deduction_cap_2000man(self):
        self.assertEqual(earned_income_deduction(300_000_000), 18_750_000)  # 1,475만 + 2억 × 2%
        self.assertEqual(earned_income_deduction(400_000_000), 20_000_000)  # 2,075만 → §47① 단서 2천만원


class EarnedIncomeCredit(unittest.TestCase):
    def test_low_tax_55_percent(self):
        self.assertEqual(earned_income_credit(1_000_000, 20_000_000), 550_000)

    def test_high_tax_formula_and_limit(self):
        # 산출 155만2,500 → 71만5천 + 25만2,500 × 30% = 79만750, 한도(3,300만 이하) 74만
        self.assertEqual(earned_income_credit(1_552_500, 30_000_000), 740_000)

    def test_limits_by_total_salary(self):
        big = 10_000_000
        self.assertEqual(earned_income_credit(big, 50_000_000), 660_000)   # 74만 − 1,700만×8/1000=60.4만 → 66만
        self.assertEqual(earned_income_credit(big, 60_000_000), 660_000)   # 74만 − 21.6만 = 52.4만 → 66만
        self.assertEqual(earned_income_credit(big, 40_000_000), 684_000)   # 74만 − 700만×8/1000 = 68.4만
        self.assertEqual(earned_income_credit(big, 80_000_000), 500_000)   # 66만 − 500만 → 50만
        self.assertEqual(earned_income_credit(big, 130_000_000), 200_000)  # 50만 − 500만 → 20만


class ChildCredit(unittest.TestCase):
    def test_amounts(self):
        self.assertEqual(child_credit(0), 0)
        self.assertEqual(child_credit(1), 250_000)
        self.assertEqual(child_credit(2), 550_000)
        self.assertEqual(child_credit(3), 950_000)   # 55만 + 40만


class SocialInsurance(unittest.TestCase):
    def test_50m(self):
        # 월 4,166,666 · 연금 197,916→197,910 · 건강 149,791→149,790 · 장기요양 149,790×9448/71900=19,683→19,680
        # · 고용 37,499
        pension, ins = estimate_social_insurance(50_000_000)
        self.assertEqual(pension, 197_910 * 12)
        self.assertEqual(ins, (149_790 + 19_680 + 37_499) * 12)

    def test_pension_cap(self):
        # 월 1,000만 > 상한 → 1~6월 637만×4.75%=302,575→302,570 · 7~12월 659만×4.75%=313,025→313,020
        pension, _ = estimate_social_insurance(120_000_000)
        self.assertEqual(pension, 6 * 302_570 + 6 * 313_020)


class Scenarios(unittest.TestCase):
    def test_50m_single_default(self):
        """'연봉 5000' 기본 가정(본인 1명, 4대보험 추정)."""
        r = calculate(IncomeTaxInput(total_salary=50_000_000))
        self.assertEqual(r.step("earned_income_deduction").value, 12_250_000)  # 1,200만 + 500만 × 5%
        self.assertEqual(r.step("earned_income").value, 37_750_000)
        self.assertEqual(r.step("basic_deduction").value, 1_500_000)
        # 보험료 소득공제 갈래: 3,775만 − 150만 − 2,374,920 − 2,483,628 = 31,391,452
        self.assertEqual(r.step("tax_base").value, 31_391_452)
        self.assertEqual(r.step("computed_tax").value, 3_448_717)   # 84만 + 17,391,452 × 15%
        self.assertEqual(r.step("earned_income_credit").value, 660_000)
        self.assertEqual(r.option, "insurance_deduction")
        self.assertEqual(r.determined_tax, 2_788_717)
        # 표준세액공제 갈래: 과세표준 33,875,080 → 산출 3,821,262 − 66만 − 13만
        self.assertEqual(r.other_option_tax, 3_031_262)
        self.assertEqual(r.local_tax, 278_871)
        self.assertEqual(r.total_tax, 3_067_588)
        self.assertEqual(r.estimated, ["pension_paid", "insurance_paid"])

    def test_50m_two_dependents(self):
        """후속 '부양가족 2명' → 기본공제 450만."""
        r = calculate(IncomeTaxInput(total_salary=50_000_000, dependents=2))
        self.assertEqual(r.step("basic_deduction").value, 4_500_000)
        self.assertEqual(r.step("tax_base").value, 28_391_452)
        self.assertEqual(r.step("computed_tax").value, 2_998_717)   # 84만 + 14,391,452 × 15%
        self.assertEqual(r.determined_tax, 2_338_717)
        self.assertEqual(r.other_option_tax, 2_581_262)
        self.assertEqual(r.local_tax, 233_871)

    def test_30m_no_insurance_picks_standard_credit(self):
        r = calculate(IncomeTaxInput(total_salary=30_000_000, pension_paid=0, insurance_paid=0))
        self.assertEqual(r.step("earned_income_deduction").value, 9_750_000)  # 750만 + 1,500만 × 15%
        self.assertEqual(r.step("tax_base").value, 18_750_000)
        self.assertEqual(r.step("computed_tax").value, 1_552_500)
        self.assertEqual(r.option, "standard_credit")               # 보험료 0 → 13만원 쪽이 유리
        self.assertEqual(r.determined_tax, 1_552_500 - 740_000 - 130_000)
        self.assertEqual(r.local_tax, 68_250)
        self.assertEqual(r.estimated, [])

    def test_low_income_zero_tax(self):
        r = calculate(IncomeTaxInput(total_salary=10_000_000, dependents=2))
        self.assertEqual(r.step("earned_income").value, 4_500_000)  # 1,000만 − (350만 + 500만 × 40%)
        self.assertEqual(r.step("basic_deduction").value, 4_500_000)  # 450만, §51④ 종합소득금액 한도
        self.assertEqual(r.step("tax_base").value, 0)
        self.assertEqual(r.total_tax, 0)

    def test_child_credit_reduces_tax(self):
        base = calculate(IncomeTaxInput(total_salary=50_000_000, dependents=2))
        kid = calculate(IncomeTaxInput(total_salary=50_000_000, dependents=2, children_credit=2))
        self.assertEqual(base.determined_tax - kid.determined_tax, 550_000)

    def test_every_step_cites_basis_except_total(self):
        r = calculate(IncomeTaxInput(total_salary=50_000_000))
        for s in r.steps:
            if s.key != "total_tax":
                self.assertTrue(s.basis, s.key)

    def test_rejects_negative(self):
        with self.assertRaises(ValueError):
            calculate(IncomeTaxInput(total_salary=-1))


if __name__ == "__main__":
    unittest.main()
