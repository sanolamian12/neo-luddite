"""calc.income_tax_extract 단위 테스트 — 실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_income_tax_extract -v"""

import unittest

from calc.income_tax_extract import (
    merge_slots,
    parse_amount,
    read_children,
    read_dependents,
    read_nontaxable,
    read_reply,
    read_salary,
    read_salary_change,
)


class Amount(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(parse_amount("5000"), 50_000_000)        # 만원 생략
        self.assertEqual(parse_amount("4천"), 40_000_000)         # Y02 "연봉 4천"
        self.assertEqual(parse_amount("5천5백"), 55_000_000)
        self.assertEqual(parse_amount("5,000만원"), 50_000_000)
        self.assertEqual(parse_amount("5000만 원"), 50_000_000)
        self.assertEqual(parse_amount("50,000,000원"), 50_000_000)
        self.assertEqual(parse_amount("1억2천"), 120_000_000)
        self.assertEqual(parse_amount("1억 2천만원"), 120_000_000)
        self.assertEqual(parse_amount("1억"), 100_000_000)
        self.assertEqual(parse_amount("400만원"), 4_000_000)
        self.assertEqual(parse_amount("20만"), 200_000)


class Salary(unittest.TestCase):
    def test_annual(self):
        self.assertEqual(read_salary(["연봉 5000인데 내년 소득세 얼마야"]), 50_000_000)
        self.assertEqual(read_salary(["연봉 4천 받는 직장인인데 세금 얼마나 떼요?"]), 40_000_000)
        self.assertEqual(read_salary(["연봉이 5,000만 원이에요"]), 50_000_000)
        self.assertEqual(read_salary(["세전 6천이면 세금 얼마?"]), 60_000_000)
        self.assertEqual(read_salary(["연봉 1억2천인데요"]), 120_000_000)

    def test_monthly(self):
        self.assertEqual(read_salary(["월급 400만원인데 세금 얼마예요"]), 48_000_000)
        self.assertEqual(read_salary(["한 달에 350 받아요"]), 42_000_000)

    def test_calendar_month_is_not_salary(self):
        self.assertIsNone(read_salary(["10월 5000만원 받은 성과급"]))

    def test_later_value_wins(self):
        self.assertEqual(read_salary(["연봉 5000인데", "아 연봉 6천이에요"]), 60_000_000)

    def test_none(self):
        self.assertIsNone(read_salary(["연말정산 의료비 공제 요건이 뭐야?"]))


class SalaryChange(unittest.TestCase):
    def test_change_takes_after_value(self):
        t = ["올해 연봉이 3800에서 4500으로 올랐는데 세금 구간이 바뀌나요?"]
        self.assertEqual(read_salary_change(t), (38_000_000, 45_000_000))
        self.assertEqual(read_salary(t), 45_000_000)


class Family(unittest.TestCase):
    def test_dependents(self):
        self.assertEqual(read_dependents(["부양가족 2명"]), 2)
        self.assertEqual(read_dependents(["부양가족은 두 명이에요"]), 2)
        self.assertEqual(read_dependents(["4인 가구예요"]), 3)
        self.assertEqual(read_dependents(["1인 가구예요"]), 0)
        self.assertEqual(read_dependents(["혼자 살아요"]), 0)
        self.assertEqual(read_dependents(["부양가족 없어요"]), 0)
        self.assertIsNone(read_dependents(["연봉 5000"]))

    def test_children(self):
        self.assertEqual(read_children(["자녀 2명이에요"]), 2)
        self.assertEqual(read_children(["아이가 둘 있어요"]), 2)
        self.assertEqual(read_children(["자녀는 없어요"]), 0)
        self.assertIsNone(read_children(["애매하게 두 번 받았어요"]))

    def test_nontaxable(self):
        self.assertEqual(read_nontaxable(["식대 20만원 받아요"]), 2_400_000)
        self.assertEqual(read_nontaxable(["비과세 월 20만"]), 2_400_000)
        self.assertEqual(read_nontaxable(["비과세는 없어요"]), 0)


class Reply(unittest.TestCase):
    def test_bare_count_goes_to_first_asked(self):
        self.assertEqual(read_reply("2명이요", ["dependents", "nontaxable"]), {"dependents": 2})
        self.assertEqual(read_reply("둘이요", ["children_credit"]), {})          # '명' 없는 맨 수는 안 받음
        self.assertEqual(read_reply("두 명", ["children_credit"]), {"children_credit": 2})

    def test_none_zeroes_all_asked(self):
        self.assertEqual(read_reply("둘 다 없어요", ["dependents", "nontaxable"]),
                         {"dependents": 0, "nontaxable": 0})

    def test_amount_goes_to_nontaxable(self):
        self.assertEqual(read_reply("20만원이요", ["nontaxable"]), {"nontaxable": 2_400_000})
        self.assertEqual(read_reply("20만원이요", ["dependents"]), {})

    def test_household_reply_is_not_amount(self):
        # W01 2턴 로컬 실측 — "1인 가구예요"의 1을 비과세 월 1만원으로 읽어 총급여가 49,880,000원이 됐다
        self.assertEqual(read_reply("1인 가구예요", ["dependents", "nontaxable"]), {})


class Merge(unittest.TestCase):
    def test_child_mention_raises_dependents_not_child_credit(self):
        texts = ["연봉 7천이면 실수령액이 얼마예요?", "배우자랑 애 하나 있어요"]
        self.assertEqual(merge_slots({}, texts), {"total_salary": 70_000_000, "dependents": 1})
        self.assertEqual(merge_slots({"dependents": 2, "children_credit": 1}, texts),
                         {"total_salary": 70_000_000, "dependents": 2})      # 자녀세액공제는 말로 안 넣는다

    def test_child_credit_when_named(self):
        out = merge_slots({"children_credit": 1}, ["연봉 7천, 자녀세액공제 대상 아이 하나"])
        self.assertEqual(out["children_credit"], 1)

    def test_parser_beats_solar(self):
        out = merge_slots({"total_salary": 5000}, ["연봉 5000인데 소득세 얼마야"])
        self.assertEqual(out["total_salary"], 50_000_000)

    def test_solar_salary_needs_number_in_text(self):
        self.assertEqual(merge_slots({"total_salary": 50_000_000}, ["5천 받는데 세금 얼마?"]),
                         {"total_salary": 50_000_000})
        self.assertEqual(merge_slots({"total_salary": 50_000_000}, ["세금 얼마 나와?"]), {})

    def test_solar_count_needs_family_word(self):
        self.assertEqual(merge_slots({"dependents": 2}, ["연봉 5000"]), {"total_salary": 50_000_000})
        self.assertEqual(merge_slots({"dependents": 1}, ["연봉 5000, 아내가 전업주부예요"]),
                         {"total_salary": 50_000_000, "dependents": 1})


if __name__ == "__main__":
    unittest.main()
