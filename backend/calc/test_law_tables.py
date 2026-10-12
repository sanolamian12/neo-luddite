"""법령 표 복원(F1) 단위 테스트 — 상자 표 파싱 · 조문 표 블록 · 세율 질문 표 선택. Solar·DB 호출 없음.
실행: cd backend && .venv\\Scripts\\python.exe -m unittest calc.test_law_tables -v"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import law_tables_api as T  # noqa: E402

from api import pipeline  # noqa: E402
from api.law_select import Article, table_blocks  # noqa: E402

# 국가법령정보센터 API 소득세법 §47① 원문(상자 문자 표, 긴 칸은 다음 시각 줄로 넘어간다)
BOX47 = ("┌───────────────┬──────────────────────────┐│총급여액                      │공제액                                              │"
         "├───────────────┼──────────────────────────┤│500만원 이하                  │총 급여액의 100분의 70                              │"
         "├───────────────┼──────────────────────────┤│1천 500만원 초과 4천 500만원  │750만원＋(1천 500만원을 초과하는 금액의 100분의 15) │"
         "│이하                          │                                                    │"
         "└───────────────┴──────────────────────────┘")


def art(law, no, title, text):
    return Article(law, no, title, text, [], "")


class BoxParsing(unittest.TestCase):
    def test_rows_and_wrapped_cell(self):
        rows = T.box_to_rows(BOX47)
        self.assertEqual(rows[0], ["총급여액", "공제액"])
        self.assertEqual(rows[1], ["500만원 이하", "총 급여액의 100분의 70"])
        self.assertEqual(rows[2], ["1천 500만원 초과 4천 500만원 이하", "750만원＋(1천 500만원을 초과하는 금액의 100분의 15)"])

    def test_insert_after_lead_line(self):
        text = "제47조(근로소득공제) ①근로소득이 있는 거주자에 대해서는 다음의 금액을 공제한다.\n② 일용근로자는 1일 15만원."
        new, n, tail = T.insert_tables(text, [("①근로소득이 있는 거주자에 대해서는 다음의 금액을 공제한다.<개정 2019.12.31>", BOX47)])
        self.assertEqual((n, tail), (1, 0))
        lines = new.split("\n")
        self.assertEqual(lines[1], "[표]")
        self.assertTrue(lines[-1].startswith("② 일용근로자"))


class Blocks(unittest.TestCase):
    def test_table_blocks_with_ho_caption(self):
        a = art("법인세법", "55", "세율", "제55조(세율) ① …세율을 적용한다.\n1. 내국법인의 경우\n[표]\n과세표준 | 세율\n2억원 이하 | 과세표준의 100분의 10\n"
                "2억원 초과 200억원 이하 | 2천만원 + (2억원을 초과하는 금액의 100분의 20)\n2. 그 밖의 경우\n[표]\n과세표준 | 세율\n200억원 이하 | 과세표준의 100분의 20")
        bs = table_blocks(a)
        self.assertEqual(len(bs), 2)
        self.assertEqual(bs[0].caption, "1. 내국법인의 경우")
        self.assertEqual(bs[0].header, ["과세표준", "세율"])
        self.assertEqual(len(bs[0].rows), 2)


class TableSegments(unittest.TestCase):
    def law(self, *articles):
        return pipeline._LawStep(passages=[], block="", allowed=set(), labels=[], texts=[],
                                 tables=[t for a in articles for t in table_blocks(a)])

    def test_picks_closest_article(self):
        a55 = art("소득세법", "55", "세율", "제55조(세율) ①…\n[표]\n과세표준 | 세율\n1,400만원 이하 | 과세표준의 6퍼센트")
        a104 = art("소득세법", "104", "양도소득세의 세율", "제104조(양도소득세의 세율)\n8. 비사업용 토지\n[표]\n과세표준 | 세율\n1,400만원 이하 | 16퍼센트")
        segs = pipeline._table_segments(self.law(a104, a55), "현재 적용되는 종합소득세율 알려주세요")
        self.assertIn("소득세법 제55조", segs[0]["text"])
        self.assertTrue(all("16퍼센트" not in s["text"] for s in segs))
        segs = pipeline._table_segments(self.law(a55, a104), "양도소득세 세율 알려주세요")
        self.assertIn("소득세법 제104조", segs[0]["text"])

    def test_no_table_for_non_rate_question(self):
        a55 = art("소득세법", "55", "세율", "제55조(세율) ①…\n[표]\n과세표준 | 세율\n1,400만원 이하 | 과세표준의 6퍼센트")
        self.assertEqual(pipeline._table_segments(self.law(a55), "종합소득세 신고 기한이 언제예요?"), [])



class UnknownDocRefs(unittest.TestCase):
    def test_prompt_example_numbers_are_dropped(self):
        # F1 운영 10/12 X07 — 프롬프트 예시 문서번호를 실제 사례처럼 인용
        from types import SimpleNamespace as NS
        raw = [{"text": "국세청의 기존 해석 사례(조심 2024서0560, 서면-2022-원천-4266)에서는 순차 적용합니다."},
               {"text": "서면-2021-법규부가-6187 회신은 제조업 간이과세 배제를 확인했습니다."},
               {"text": "증여세는 누진 구조입니다."}]
        kept = pipeline._drop_unknown_doc_refs(raw, [NS(case_refs=["서면-2021-법규부가-6187"], content="")], "t")
        self.assertEqual([k["text"][:6] for k in kept], ["서면-2021", "증여세는 누"])


if __name__ == "__main__":
    unittest.main()
