"""calc.income_tax_view 단위 테스트 — 실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_income_tax_view -v"""

import unittest

from calc.income_tax import calculate
from calc.income_tax_slots import fill
from calc.income_tax_view import change_line, headline, law_label, step_rows, step_table, takehome, trace_text


class View(unittest.TestCase):
    def setUp(self):
        self.f = fill({"total_salary": 50_000_000})
        self.r = calculate(self.f.inp)

    def test_law_label_matches_article_label(self):
        self.assertEqual(law_label("소득세법", "51의3"), "소득세법 제51조의3")
        self.assertEqual(law_label("지방세법", "103의13"), "지방세법 제103조의13")

    def test_headline(self):
        self.assertEqual(headline(self.f, self.r),
                         "총급여 50,000,000원, 본인 1명(1인 가구)으로 가정하고 2026년 시행 세법으로 계산하면 1년 근로소득세는 "
                         "2,788,717원이고, 지방소득세 278,871원을 더하면 3,067,588원(월 평균 약 255,632원)입니다.")

    def test_zero_tax_headline(self):
        f = fill({"total_salary": 10_000_000, "dependents": 2})
        self.assertIn("낼 근로소득세가 없습니다", headline(f, calculate(f.inp)))

    def test_rows_cite_exact_articles(self):
        rows = step_rows(self.r)
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[1].citations, ["소득세법 제50조", "소득세법 제51조의3", "소득세법 제52조"])
        self.assertIn("과세표준 31,391,452원", rows[1].text)
        self.assertIn("15% 구간", rows[2].text)
        self.assertNotIn("소득세법 제51조", rows[1].citations)   # '제51조의3' 안의 오탐 배지 없음

    def test_trace_text_has_every_value(self):
        t = trace_text(self.f, self.r)
        for st in self.r.steps:
            self.assertIn(f"{st.value:,}원", t)
        self.assertIn("부양가족 없음(1인 가구)", t)


    def test_takehome(self):
        t = takehome(50_000_000, self.r)
        ins = 2_374_920 + 2_483_628
        take = 50_000_000 - ins - 3_067_588
        self.assertIn(f"1년 실수령액은 약 {take:,}원", t)

    def test_change_line_same_bracket(self):
        f = fill({"total_salary": 45_000_000})
        line = change_line(38_000_000, f, calculate(f.inp))
        self.assertIn("적용 세율 구간은 그대로입니다", line)
        self.assertIn("(15% 구간)", line)


    def test_assumed_amounts_are_tagged(self):
        # 세무사 피드백 10/13 — 가정·추정 금액은 금액 옆에 표시
        rows = step_rows(self.r, self.f.assumed)
        self.assertIn("50,000,000원(가정: 비과세 수당 0원)", rows[0].text)
        self.assertIn("1,500,000원(가정: 본인 1명)", rows[1].text)
        self.assertIn("(추정: 2026년 국민연금 요율)", rows[1].text)
        told = fill({"total_salary": 50_000_000, "dependents": 0, "nontaxable": 0,
                     "pension_paid": 2_000_000, "insurance_paid": 2_000_000})
        plain = step_rows(calculate(told.inp), told.assumed)
        self.assertNotIn("가정", plain[0].text + plain[1].text)
        self.assertNotIn("추정", plain[1].text)

    def test_step_table_matches_rows(self):
        # 10/14 answer_display.TABLES — 표 칸 값은 문장(step_rows)과 같은 수여야 한다
        rows = step_rows(self.r, self.f.assumed)
        table = step_table(rows).split("\n")
        self.assertEqual(table[0], "| 단계 | 계산 | 결과 | 근거 |")
        self.assertEqual(len(table), 2 + len(rows))
        for line, row in zip(table[2:], rows):
            self.assertTrue(line.startswith(f"| {row.text[0]} |"))
            self.assertIn(row.result.strip("*"), row.text)
            self.assertIn(row.law, row.text)


if __name__ == "__main__":
    unittest.main()
