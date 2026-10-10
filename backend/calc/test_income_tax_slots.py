"""calc.income_tax_slots 단위 테스트 — 실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_income_tax_slots -v"""

import unittest

from calc.income_tax import IncomeTaxInput, calculate
from calc.income_tax_slots import (
    ASSUME_DEPENDENTS,
    ASSUME_INSURANCE,
    ASSUME_NONTAXABLE,
    NOT_MODELED,
    assumption_segments,
    fill,
    followup_questions,
)


class Fill(unittest.TestCase):
    def test_no_salary_asks_only_salary(self):
        f = fill({"dependents": 2})
        self.assertIsNone(f.inp)
        self.assertEqual([s.key for s in followup_questions({"dependents": 2})], ["total_salary"])

    def test_salary_only_uses_conservative_defaults(self):
        f = fill({"total_salary": 50_000_000})
        self.assertEqual(f.inp, IncomeTaxInput(total_salary=50_000_000))
        self.assertEqual(f.assumed, ["dependents", "nontaxable", "insurance"])

    def test_user_values_are_not_assumed(self):
        f = fill({"total_salary": 50_000_000, "dependents": 2, "nontaxable": 2_400_000,
                  "pension_paid": 2_000_000, "insurance_paid": 2_000_000})
        self.assertEqual(f.inp.total_salary, 47_600_000)      # 비과세 연 240만 차감
        self.assertEqual(f.inp.dependents, 2)
        self.assertEqual(f.assumed, ["children_credit"])      # 부양가족이 있으니 자녀 수는 가정 대상

    def test_zero_dependents_said_is_not_assumed(self):
        f = fill({"total_salary": 50_000_000, "dependents": 0})
        self.assertNotIn("dependents", f.assumed)
        self.assertNotIn("children_credit", f.assumed)

    def test_counts_are_clamped(self):
        f = fill({"total_salary": 50_000_000, "dependents": 1, "children_credit": 3, "elderly70": 5})
        self.assertEqual(f.inp.children_credit, 1)            # 자녀 ≤ 부양가족
        self.assertEqual(f.inp.elderly70, 2)                  # 경로우대 ≤ 본인 포함 기본공제대상자

    def test_bad_values_ignored(self):
        f = fill({"total_salary": "5천만", "dependents": True})
        self.assertIsNone(f.inp)


class Questions(unittest.TestCase):
    def test_max_two_and_order(self):
        qs = followup_questions({"total_salary": 50_000_000})
        self.assertEqual([s.key for s in qs], ["dependents", "nontaxable"])

    def test_children_asked_after_dependents_known(self):
        qs = followup_questions({"total_salary": 50_000_000, "dependents": 2, "nontaxable": 0})
        self.assertEqual([s.key for s in qs], ["children_credit"])

    def test_asked_slots_not_repeated(self):
        qs = followup_questions({"total_salary": 50_000_000}, asked={"dependents", "nontaxable"})
        self.assertEqual(qs, [])

    def test_everything_known_no_questions(self):
        qs = followup_questions({"total_salary": 50_000_000, "dependents": 0, "nontaxable": 0})
        self.assertEqual(qs, [])


class Segments(unittest.TestCase):
    def test_default_assumption_texts_and_what_if(self):
        f = fill({"total_salary": 50_000_000})
        r = calculate(f.inp)
        seg = assumption_segments(f, r)
        texts = [s["text"] for s in seg]
        self.assertIn(ASSUME_DEPENDENTS, texts)
        self.assertIn(ASSUME_NONTAXABLE, texts)
        self.assertIn(ASSUME_INSURANCE, texts)
        self.assertIn(NOT_MODELED, texts)
        # 부양가족 1명 → 기본공제 +150만 → 과세표준 −150만(15% 구간). 소득세 22.5만, 근로소득세액공제는 한도(66만)라 불변,
        # 지방소득세 2만2,500 → 합계 24만7,500원
        self.assertIn("부양가족이 1명 있으면 기본공제 150만원이 더해져 세금이 247,500원 줄어듭니다.", texts)
        # 식대 월 20만(연 240만) 비과세 → 총급여 4,760만: 근로소득공제·4대보험 추정도 같이 바뀌므로 다시 계산한 값
        alt = calculate(IncomeTaxInput(total_salary=47_600_000))
        self.assertIn(f"식대 비과세가 월 20만원이면 세금이 {r.total_tax - alt.total_tax:,}원 줄어듭니다.", texts)
        self.assertEqual({s["type"] for s in seg}, {"caveat", "application"})

    def test_no_assumption_lines_when_all_given(self):
        f = fill({"total_salary": 50_000_000, "dependents": 0, "nontaxable": 0,
                  "pension_paid": 2_374_920, "insurance_paid": 2_483_628})
        seg = assumption_segments(f, calculate(f.inp))
        self.assertEqual([s["text"] for s in seg], [NOT_MODELED])


if __name__ == "__main__":
    unittest.main()
