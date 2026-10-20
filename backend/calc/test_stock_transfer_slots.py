"""calc.stock_transfer_extract · calc.stock_transfer_slots 단위 테스트 — Solar·DB 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_stock_transfer_slots -v

질문 문장은 테스트용으로 만든 것(내부 제작). 캡처 사례 기대값은 test_stock_transfer 와 같다(테스트에만 씀)."""

import unittest

from calc.stock_transfer import EOK, MAN, calculate
from calc.stock_transfer_extract import read_relation, read_slots
from calc.stock_transfer_slots import fill, invite, missing_question, scenarios
from calc.stock_transfer_view import (NOT_MODELED, assumed_line, assumed_line_cases, case_clause, case_headline,
                                      case_label, case_table, common_table, conclusion_markdown, headline,
                                      sections_markdown, sections_markdown_cases, summary_table, trace_text_cases)

CAPTURE_Q = ("비상장 중소기업 지분 65%를 보유하고 있습니다. 시가 10억, 취득가 1억인 주식을 아들에게 3억에 양도하려고 합니다. "
             "세금 문제와 세액을 알려주세요.")


class Extract(unittest.TestCase):
    def test_capture_question(self):
        self.assertEqual(read_slots([CAPTURE_Q]),
                         {"market_value": 10 * EOK, "acquisition": 1 * EOK, "price": 3 * EOK, "share_pct": 65.0,
                          "market": "unlisted", "size": "sme", "relation": "child"})

    def test_bought_vs_will_buy(self):
        # '샀' = 취득가 · '사려고' = 거래가
        s = read_slots(["아버지로부터 비상장 주식을 시가 5억짜리를 2억에 사려고 합니다. 아버지 취득가는 1억입니다. 저는 25살이에요."])
        self.assertEqual((s["price"], s["acquisition"], s["market_value"]), (2 * EOK, 1 * EOK, 5 * EOK))
        self.assertEqual(s["relation"], "child")            # 아버지'로부터' 산다 → 양수자는 양도자의 자녀
        self.assertFalse(s["buyer_minor"])
        s = read_slots(["10년 전에 2억에 산 비상장 주식을 5억에 팔았어요"])
        self.assertEqual((s["acquisition"], s["price"], s["holding_months"]), (2 * EOK, 5 * EOK, 120))

    def test_holding_and_size(self):
        s = read_slots(["중견기업 주식 10%를 6개월 전에 3억에 샀는데 4억에 팔려고 해요"])
        self.assertEqual((s["holding_months"], s["size"], s["share_pct"]), (6, "mid", 10.0))
        self.assertEqual(read_slots(["1년이 안 된 주식이에요"])["holding_months"], 6)
        self.assertEqual(read_slots(["중소기업이 아닌 회사 주식"])["size"], "large")

    def test_market_and_trade_way(self):
        s = read_slots(["코스닥 상장사 지분 3%를 갖고 있는데 장외에서 친구에게 20억에 넘기면 세금이 얼마인가요? 취득가는 5억이에요."])
        self.assertEqual((s["market"], s["on_market"], s["relation"], s["share_pct"]), ("kosdaq", False, "unrelated", 3.0))
        self.assertEqual(read_slots(["상장주식을 증권시장에서 팔면"])["market"], "listed")
        self.assertTrue(read_slots(["상장주식을 증권시장에서 팔면"])["on_market"])
        self.assertEqual(read_slots(["K-OTC 에서 거래되는 주식"])["market"], "kotc")

    def test_at_market_price(self):
        s = read_slots(["시가대로 딸에게 넘기면요? 시가 4억, 취득가 1억"])
        self.assertEqual(s["price"], 4 * EOK)

    def test_relation_words(self):
        self.assertEqual(read_relation(["손자에게 넘기려 합니다"]), "grandchild")
        self.assertEqual(read_relation(["아버지에게 팔려고요"]), "parent")
        self.assertEqual(read_relation(["어머니가 가진 주식을 딸이 사려고 해요"]), "child")
        self.assertEqual(read_relation(["특수관계가 없는 거래처에 팔았어요"]), "unrelated")
        self.assertEqual(read_relation(["특수관계인에게 양도"]), "other_related")
        self.assertIsNone(read_relation(["유형별로 알려주세요"]))      # '형' 오탐 없음

    def test_minor_and_prior_gift(self):
        s = read_slots(["고등학생 손자에게 비상장 주식(시가 3억, 취득가 5천만원)을 1억에 넘기려 합니다. 5년 전에 3천만원 증여한 적 있어요"])
        self.assertTrue(s["buyer_minor"])
        self.assertEqual(s["prior_deduction_used"], 3_000 * MAN)
        self.assertNotIn("holding_months", s)                   # '5년 전에 … 증여' 는 보유기간이 아님
        self.assertFalse(read_slots(["65세 어머니에게"]).get("buyer_minor", False))
        self.assertEqual(read_slots(["증여받은 적은 없어요"])["prior_deduction_used"], 0)

    def test_later_utterance_wins(self):
        s = read_slots(["시가 10억 주식을 아들에게 3억에 넘기려 해요. 취득가 1억", "아 그리고 아들은 17살이에요",
                        "거래가는 4억으로 할게요"])
        self.assertTrue(s["buyer_minor"])
        self.assertEqual(s["price"], 4 * EOK)


class Slots(unittest.TestCase):
    def test_capture_end_to_end(self):
        f = fill(read_slots([CAPTURE_Q]))
        self.assertEqual(f.missing_required, [])
        r = calculate(f.inp)
        self.assertEqual(r.total, 3_500_000 + 229_350_000 + 58_200_000)
        self.assertEqual(f.assumed, ["buyer_minor", "prior_deduction_used"])
        self.assertEqual(assumed_line(r, f.assumed), "가정: 증여받는 사람은 성년 · 10년 안에 같은 쪽(직계존속 등)에게서 받은 다른 증여 없음.")
        self.assertEqual(invite(f, r), "증여받는 사람의 나이(성년 여부)·10년 안에 같은 쪽에게서 받은 다른 증여처럼 세액을 바꾸는 "
                                       "정보를 알려주시면 반영해 다시 계산해 드리겠습니다.")

    def test_required_only(self):
        f = fill(read_slots(["주식 팔면 세금이 얼마나 나오나요?"]))
        self.assertIsNone(f.inp)
        self.assertEqual(f.missing_required, ["price", "acquisition"])
        q = missing_question(f)
        self.assertIn("거래 금액", q)
        self.assertIn("취득가", q)
        self.assertNotIn("시가(평가액)을", q)                    # 특수관계 없으면 시가는 묻지 않는다

    def test_related_needs_market_value(self):
        f = fill(read_slots(["아들에게 3억에 넘기려 해요. 취득가 1억"]))
        self.assertEqual(f.missing_required, ["market_value"])
        self.assertIn("시가", missing_question(f))

    def test_unrelated_market_value_assumed(self):
        f = fill(read_slots(["비상장 주식을 1억에 샀는데 2억에 팔려고 해요"]))
        self.assertEqual(f.inp.market_value, 2 * EOK)
        self.assertIn("market_value", f.assumed)
        self.assertEqual(f.split, ["major", "size"])            # 대주주·규모는 가정하지 않고 경우로(10/20)
        self.assertNotIn("size", f.assumed)
        sc = scenarios(f)
        # 과세표준 9,680만원 ≤ 3억 → 대주주 20% = 소액·중소기업 아님 20% → 한 줄로 합침 · 소액·중소 10%
        base = 2 * EOK - 1 * EOK - 700_000 - 2_500_000
        self.assertEqual([s.result.section("capital_gains").tax for s in sc], [base * 20 // 100, base * 10 // 100])
        self.assertEqual(case_label(sc[0]), "대주주 또는 중소기업 아님")
        self.assertEqual(case_clause(sc[0], True), "소득세법상 대주주이거나 중소기업이 아니면")
        line = assumed_line_cases(sc, f.assumed)
        for w in ("시가는 거래가와 같다고 봄", "특수관계가 아님"):
            self.assertIn(w, line)
        for w in ("성년", "중소기업", "대주주"):                  # 증여가 없으면 성년 안 적음 · 경우로 나눈 값은 가정 아님
            self.assertNotIn(w, line)
        inv = invite(f, sc)
        self.assertTrue(inv.startswith("지분율(본인과 특수관계인 합산, 직전 사업연도 말)·회사 규모(중소기업 여부)를 "
                                       "알려주시면 한 가지로 계산해 드리겠습니다."))

    def test_listed_defaults(self):
        f = fill(read_slots(["상장주식을 1억에 샀는데 1억5천에 팔면 양도세 나오나요?"]))
        self.assertEqual((f.inp.market, f.inp.on_market), ("kospi", True))
        r = calculate(f.inp)
        self.assertFalse(r.section("capital_gains").applies)    # 소액주주 장내 = 비과세
        self.assertEqual(r.total, 75_000)                        # 1.5억 × 1만분의 5
        self.assertNotIn("회사 규모", invite(f, r))               # 비과세라 규모는 결과를 안 바꾼다
        self.assertIn("증권시장(장내) 거래", assumed_line(r, f.assumed))

    def test_listed_related_off_market(self):
        f = fill(read_slots(["코스피 상장주식(시가 10억)을 아들에게 8억에 넘기려 해요. 취득가 2억"]))
        self.assertFalse(f.inp.on_market)
        r = calculate(f.inp)
        self.assertTrue(r.unfair)                                # 상장주식은 차액 기준 없이 부당행위
        self.assertEqual(r.section("securities_tax").tax, 3_500_000)   # 장외 1만분의 35, 저가 인정 → 시가액


class Cases(unittest.TestCase):
    """경우 나누기(설계 §2-4 10/20 변경) — 대주주 여부·회사 규모를 모르면 결과가 다른 경우만 줄로."""

    def _cases(self, q):
        f = fill(read_slots([q]))
        return f, scenarios(f)

    def test_capture_both_given_one_line(self):
        # 지분율·규모를 다 말한 캡처 원문 = 1줄 — 결론 문단은 기존 headline + 합계 표 + 가정 줄 그대로
        f, sc = self._cases(CAPTURE_Q)
        self.assertEqual(len(sc), 1)
        r = calculate(f.inp)
        self.assertEqual(conclusion_markdown(sc, f.assumed),
                         "\n\n".join([headline(r), summary_table(r), assumed_line(r, f.assumed)]))
        self.assertEqual(sections_markdown_cases(sc), sections_markdown(r))
        self.assertEqual(invite(f, sc), invite(f, r))

    def test_capture_without_share_two_lines(self):
        f, sc = self._cases(CAPTURE_Q.replace("지분 65%를", "주식을"))
        self.assertEqual(f.split, ["major"])
        self.assertEqual(len(sc), 2)
        self.assertEqual([case_label(s) for s in sc], ["대주주", "대주주 아님"])
        cg = [(s.result.section("capital_gains").tax, s.result.section("local_tax").tax) for s in sc]
        self.assertEqual(cg, [(208_500_000, 20_850_000), (89_400_000, 8_940_000)])   # 대주주 누진 · 소액 중소기업 10%
        common = 3_500_000 + 58_200_000
        self.assertEqual([s.result.total for s in sc], [229_350_000 + common, 98_340_000 + common])
        head = conclusion_markdown(sc, f.assumed).split("\n\n")[0]
        self.assertTrue(head.startswith("소득세법상 대주주이면 합계 291,050,000원, 대주주가 아니면 합계 160,040,000원입니다."))
        self.assertIn("소득세법 시행령 제167조의8", head)                 # '대주주'는 조문 기준과 함께
        self.assertIn("어느 경우든 양도자는 증권거래세 3,500,000원을, 양수자는 증여세 58,200,000원을 냅니다.", head)
        self.assertIn("| 대주주 아님 | 10% | 98,340,000원 | 160,040,000원 |", case_table(sc))
        self.assertIn("| 증여세 | 양수자 | 58,200,000원 |", common_table(sc))
        cg_table = dict((s.key, t) for s, _, t in sections_markdown_cases(sc))["capital_gains"]
        self.assertIn("| 과세표준 | 양도차익 − 기본공제 | 과세표준 894,000,000원 |", cg_table)    # 과세표준까지 공통(한 번)
        self.assertEqual(cg_table.count("과세표준 894,000,000원"), 1)
        self.assertIn("| 양도소득세 — 대주주 아님 |", cg_table)
        self.assertIn("208,500,000원", trace_text_cases(sc, f.assumed))
        self.assertIn("89,400,000원", trace_text_cases(sc, f.assumed))
        self.assertTrue(invite(f, sc).startswith("지분율(본인과 특수관계인 합산, 직전 사업연도 말)을 알려주시면"))

    def test_no_share_no_size_three_lines(self):
        f, sc = self._cases("비상장 주식을 보유하고 있습니다. 시가 10억, 취득가 1억인 주식을 아들에게 3억에 양도하려고 합니다.")
        self.assertEqual(len(sc), 3)
        self.assertEqual([case_label(s) for s in sc], ["대주주", "대주주 아님 · 중소기업", "대주주 아님 · 중소기업 아님"])
        self.assertEqual([s.result.section("capital_gains").tax for s in sc], [208_500_000, 89_400_000, 178_800_000])
        self.assertIn("대주주가 아니고 중소기업이 아니면 합계 258,380,000원", case_headline(sc))
        self.assertIn("회사 규모(중소기업 여부)를 알려주시면", invite(f, sc))

    def test_listed_on_market_two_lines(self):
        f, sc = self._cases("상장주식을 1억에 샀는데 1억5천에 팔면 양도세 나오나요?")
        self.assertEqual(len(sc), 2)                                      # 규모는 결과를 안 바꿔 합쳐짐
        self.assertEqual([case_label(s) for s in sc], ["대주주", "대주주 아님"])
        self.assertTrue(sc[0].result.section("capital_gains").applies)
        self.assertFalse(sc[1].result.section("capital_gains").applies)  # 소액주주 장내 = 비과세
        self.assertEqual(sc[1].result.total, 75_000)
        self.assertIn("| 대주주 아님 | 과세 대상 아님 | 없음 | 75,000원 |", case_table(sc))
        self.assertIn("소득세법 시행령 제157조", case_headline(sc))
        self.assertNotIn("회사 규모", invite(f, sc))

    def test_not_modeled_major_holder_differs(self):
        self.assertIn("최대주주 할증 평가(상속세 및 증여세법 제63조제3항 — 양도소득세의 대주주와 다른 기준)", NOT_MODELED)


if __name__ == "__main__":
    unittest.main()
