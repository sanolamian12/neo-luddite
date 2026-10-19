"""calc.stock_transfer_view 단위 테스트 — 실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_stock_transfer_view -v

캡처 사례 값은 test_stock_transfer 와 같은 기대값(테스트에만 씀)."""

import unittest

from calc.stock_transfer import EOK, MAN, StockTransferInput, calculate
from calc.stock_transfer_view import (NOT_MODELED, assumed_line, headline, section_citations, section_head,
                                      section_lead, section_rows, sections_markdown, step_table, summary_table,
                                      trace_text)
from calc.test_stock_transfer import CAPTURE


class Capture(unittest.TestCase):
    def setUp(self):
        self.r = calculate(CAPTURE)

    def test_headline_by_payer(self):
        self.assertEqual(headline(self.r),
                         "양도자는 양도소득세 208,500,000원·개인지방소득세(양도소득분) 20,850,000원·증권거래세 3,500,000원을, "
                         "양수자는 증여세 58,200,000원을 냅니다(합계 291,050,000원).")

    def test_summary_table(self):
        t = summary_table(self.r).splitlines()
        self.assertEqual(t[0], "| 세목 | 납세자 | 세액 |")
        self.assertIn("| 증여세 | 양수자 | 58,200,000원 |", t)
        self.assertIn("| 증권거래세 | 양도자 | 3,500,000원 |", t)
        self.assertEqual(t[-1], "| **합계** |  | **291,050,000원** |")

    def test_capital_gains_table(self):
        cg = self.r.section("capital_gains")
        rows = section_rows(cg)
        self.assertEqual(rows[0].calc, "부당행위계산 — 시가")
        self.assertEqual(rows[0].law, "소득세법 제101조·시행령 제167조".replace("시행령", "소득세법 시행령"))
        self.assertIn("과세표준 894,000,000원", rows[4].result)
        self.assertEqual(rows[-1].result, "**양도소득세 208,500,000원**")
        md = dict((s.key, t) for s, _, t in sections_markdown(self.r))["capital_gains"]
        self.assertIn("| 개인지방소득세 | 양도소득세 × 10분의 1 | 20,850,000원 | 지방세법 제103조의3 |", md)

    def test_gift_table_and_law_join(self):
        g = self.r.section("gift_tax")
        rows = section_rows(g)
        value = next(r for st, r in zip(g.steps, rows) if st.key == "gift_value")
        self.assertEqual(value.calc, "차액 − 기준금액 300,000,000원")
        self.assertEqual(value.law, "상속세 및 증여세법 제35조·상속세 및 증여세법 시행령 제26조")
        computed = next(r for st, r in zip(g.steps, rows) if st.key == "gift_computed")
        self.assertEqual(computed.calc, "과세표준 × 세율(20% 구간)")
        self.assertEqual(computed.law, "상속세 및 증여세법 제56조·제26조")   # 띄어 쓴 법령명도 둘째부터 조만
        self.assertIn("**증여세 58,200,000원**", step_table(g))

    def test_citations_exact(self):
        c = section_citations(self.r.section("securities_tax"))
        self.assertIn("증권거래세법 제8조", c)
        self.assertNotIn("증권거래세법 시행령 제5조", c)          # 장외 기본세율 — 탄력세율 조문은 안 붙음

    def test_section_head_and_lead(self):
        g = self.r.section("gift_tax")
        self.assertEqual(section_head(g), "■ 증여세(양수자)")
        self.assertTrue(section_lead(g).endswith("양수자가 낼 증여세는 58,200,000원입니다."))
        self.assertEqual(section_head(self.r.section("securities_tax")), "■ 증권거래세(양도자)")

    def test_assumed_line_only_what_matters(self):
        # 대주주·중소기업 → 보유기간은 세율을 안 바꾼다 → 적지 않음. 증여가 있으니 성년·10년 이력은 적음.
        line = assumed_line(self.r, ["holding_months", "buyer_minor", "prior_deduction_used"])
        self.assertTrue(line.startswith("가정: "))
        self.assertIn("성년", line)
        self.assertNotIn("1년 이상", line)

    def test_trace_has_every_tax(self):
        t = trace_text(self.r)
        for s in self.r.sections:
            self.assertIn(f"{s.tax:,}원", t)
        self.assertIn("합계: 291,050,000원", t)

    def test_not_modeled(self):
        for w in ("최대주주 할증", "농어촌특별세", "10년", "평가"):
            self.assertIn(w, NOT_MODELED)


class Others(unittest.TestCase):
    def test_listed_minor_on_market(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN,
                                         market="kospi", on_market=True, share_pct=0.1))
        self.assertEqual(headline(r), "양도자는 증권거래세 50,000원을 냅니다.")
        self.assertIn("| 양도소득세 | 양도자 | 없음 |", summary_table(r))
        cg = r.section("capital_gains")
        self.assertEqual(step_table(cg), "")
        self.assertIn("과세 대상이 아닙니다", section_lead(cg))
        # 지방소득세는 따로 절을 만들지 않는다
        self.assertEqual([s.key for s, _, _ in sections_markdown(r)], ["capital_gains", "securities_tax"])
        self.assertIn("증권시장(장내) 거래", assumed_line(r, ["on_market"]))

    def test_major_unknown_and_holding(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN, size="large",
                                         share_pct=10))
        self.assertIn("1년 이상 보유", assumed_line(r, ["holding_months"]))      # 대주주·중소기업 외 → 세율이 갈림
        u = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=5_000 * MAN))
        self.assertIn("몰라 대주주가 아닌 것으로", assumed_line(u))               # result.assumed 의 major
        self.assertNotIn("성년", assumed_line(u, ["buyer_minor"]))               # 증여 없으면 안 적음

    def test_no_tax(self):
        r = calculate(StockTransferInput(market_value=1 * EOK, price=1 * EOK, acquisition=2 * EOK, market="kotc",
                                         share_pct=0.1))
        # K-OTC 소액·중소 → 양도세 없음, 증권거래세만
        self.assertEqual(headline(r), "양도자는 증권거래세 200,000원을 냅니다.")

    def test_generation_skip_rows(self):
        r = calculate(StockTransferInput(market_value=10 * EOK, price=3 * EOK, acquisition=1 * EOK, share_pct=65,
                                         relation="grandchild"))
        g = r.section("gift_tax")
        calcs = [row.calc for row in section_rows(g)]
        self.assertTrue(any(c.startswith("세대생략 할증") for c in calcs))
        self.assertIn("산출세액 + 할증 − 신고세액공제", calcs)


if __name__ == "__main__":
    unittest.main()
