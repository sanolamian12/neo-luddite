"""법령 인용 대조 구멍(규칙 8 과제 3 ④, 10/16) — law_cite.parse_cites · law_select.check_answer 회귀 테스트(Solar 호출 없음).
실행: cd backend && .venv\\Scripts\\python.exe -m unittest api.test_law_cite -v

원문은 시민 48 운영 1회차 C03(docs/doing/demo_eval_1010/cit_prod_10161031.jsonl) — 현행에 없는 「소득세법 시행령」 제14조의3
(실제 조문은 LLM3 가 고른 조세특례제한법 시행규칙 §14의3)이 본문 대조와 결론 문단 배지를 둘 다 통과했다."""

import unittest

from api import law_cite, law_select

C03 = ("난임 시술비는 「소득세법 시행령」 제118조의5제1항제1호(의료기관 진찰·치료·질병예방 비용) 및 제14조의3(난임시술=「모자보건법」 "
       "보조생식술)의 범위 안에서 의료비 공제 대상이 될 수 있고, 산후조리원 비용은 같은 시행령 제118조의5제1항제7호에 따라 출산 1회당 "
       "200만원 이내의 금액만 공제 대상입니다.")
ALLOWED = {("소득세법 시행령", "118의5"), ("조세특례제한법 시행규칙", "14의3")}


class FollowAfterParen(unittest.TestCase):
    def test_c03_reads_article_after_paren(self):
        keys = [c.key for c in law_cite.parse_cites(C03)]
        self.assertIn(("소득세법 시행령", "14의3"), keys)
        self.assertIn(("소득세법 시행령", "118의5"), keys)

    def test_plain_follow_unchanged(self):
        keys = [c.key for c in law_cite.parse_cites("「소득세법」 제12조 및 제14조, 제20조제1항")]
        self.assertEqual(keys, [("소득세법", "12"), ("소득세법", "14"), ("소득세법", "20")])

    def test_paren_with_other_law_then_new_law(self):
        # 괄호 뒤가 다른 법 이름이면 이어 잡지 않는다 / 괄호 속 인용도 그대로 읽는다
        keys = [c.key for c in law_cite.parse_cites("「소득세법」 제12조(「조세특례제한법」 제10조 참조) 및 「법인세법」 제55조")]
        self.assertEqual(keys, [("소득세법", "12"), ("조세특례제한법", "10"), ("법인세법", "55")])


F3 = ("비상장주식 양도 시 증권거래세 납세의무자는 양도자인 아버지이고, 과세표준은 증권거래세법 제7조 제1항 제2호에 따라 원칙적으로 "
      "양도가액을 기준으로 하되, 소득세법 제101조 등에 따라 시가보다 낮은 가액으로 양도된 것으로 인정되면 그 시가액이 과세표준이 될 수 "
      "있으며, 세율은 같은 법 제8조 제1항에 따라 1만분의 35입니다.")
STT = {("증권거래세법", "7"), ("증권거래세법", "8"), ("소득세법", "101")}


class SameLaw(unittest.TestCase):
    """10/16 로컬 C1 — '같은 법 제N조' 가 앞 낱말과 붙어 대조를 아예 안 거쳤고, 바로 앞 법으로 읽으면 맞는 문장이 빠진다."""

    def test_parser_reads_same_law_after_words(self):
        keys = [c.key for c in law_cite.parse_cites(F3)]
        self.assertIn(("소득세법", "8"), keys)        # 가장 가까운 법으로 읽는다(그래서 아래 고쳐 쓰기가 필요)

    def test_qualified_to_allowed_law(self):
        out, rep = law_select.check_answer([{"text": F3, "type": "rule_statement"}], STT, mode="drop")
        self.assertEqual(rep.flagged, [])
        self.assertIn("「증권거래세법」 제8조", out[0]["text"])

    def test_unknown_same_law_still_flagged(self):
        t = "소득세법 제101조에 따라 판단하고, 세율은 같은 법 제999조에 따릅니다."
        _, rep = law_select.check_answer([{"text": t, "type": "rule_statement"}], STT, mode="drop")
        self.assertEqual([f["cites"] for f in rep.flagged], [["소득세법 제999조"]])

    def test_same_law_across_segments(self):
        raw = [{"text": "증권거래세법 제7조는 과세표준을 정합니다.", "type": "rule_statement"},
               {"text": "소득세법 제101조가 적용되면 시가가 기준이고, 세율은 같은 법 제8조가 정합니다.", "type": "rule_statement"}]
        out, rep = law_select.check_answer(raw, STT, mode="drop")
        self.assertEqual(rep.flagged, [])
        self.assertIn("「증권거래세법」 제8조", out[1]["text"])


class CheckAnswer(unittest.TestCase):
    def test_c03_sentence_flagged(self):
        out, rep = law_select.check_answer([{"text": C03, "type": "application"}], ALLOWED, mode="drop")
        self.assertEqual([f["cites"] for f in rep.flagged], [["소득세법 시행령 제14조의3"]])

    def test_c03_summary_badge_removed(self):
        seg = {"text": "산후조리원 비용은 「소득세법 시행령」 제118조의5제1항제7호에 따라 출산 1회당 200만원 한도입니다.",
               "type": "summary", "citations": ["소득세법 시행령 제14조의3", "소득세법 시행령 제118조의5", "서면-2026-원천-0004"]}
        out, rep = law_select.check_answer([seg], ALLOWED, mode="drop")
        self.assertEqual(out[0]["citations"], ["소득세법 시행령 제118조의5", "서면-2026-원천-0004"])
        self.assertEqual(rep.flagged, [])

    def test_bare_article_badge_read_with_sentence_law(self):
        seg = {"text": "「소득세법 시행령」 제118조의5제1항은 의료비 범위를 정합니다.", "type": "application",
               "citations": ["제14조의3", "제118조의5"]}
        out, _ = law_select.check_answer([seg], ALLOWED, mode="drop")
        self.assertEqual(out[0]["citations"], ["제118조의5"])

    def test_bare_article_badge_without_law_dropped(self):
        seg = {"text": "의료비 공제 대상인지 확인이 필요합니다.", "type": "caveat", "citations": ["제14조의3", "서면-2026-원천-0004"]}
        out, _ = law_select.check_answer([seg], ALLOWED, mode="drop")
        self.assertEqual(out[0]["citations"], ["서면-2026-원천-0004"])


if __name__ == "__main__":
    unittest.main()
