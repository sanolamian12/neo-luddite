"""
Collector: 국가법령정보센터 판례 (law.go.kr prec API)

Fetches court decisions (대법원 판례) that are tax-related.
Can supplement the tribunal collector with 대법원 tax judgments.

API key (OC): https://open.law.go.kr/LSO/openApi/keyApplyView.do
"""

import logging
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from collectors.http_client import HttpClient
from collectors.schema import TaxCase
from collectors.nts_expc import _infer_tax_category, _date_normalise

logger = logging.getLogger(__name__)

PREC_SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do"
PREC_DETAIL_URL = "https://www.law.go.kr/DRF/lawService.do"


class _HtmlStrip(HTMLParser):
    parts: list[str] = []
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, d):
        self.parts.append(d)
    def text(self):
        return " ".join(p.strip() for p in self.parts if p.strip())


def _strip(html: str) -> str:
    p = _HtmlStrip()
    p.feed(html)
    return p.text()


def _xml(elem, tag: str, default: str = "") -> str:
    n = elem.find(tag)
    return (n.text or "").strip() if n is not None else default


class LawPrecCollector:
    """
    Fetches tax-related court precedents from law.go.kr.
    Searches using tax keywords and filters results.
    """

    def __init__(self):
        self.client = HttpClient(delay=config.REQUEST_DELAY, ssl_verify=config.SSL_VERIFY)
        self.oc = config.LAW_OC_KEY

    def _search_page(self, query: str, page: int) -> tuple[int, list[dict]]:
        params = {
            "OC": self.oc,
            "target": "prec",
            "type": "XML",
            "query": query,
            "display": 100,
            "page": page,
            "sort": "ddes",
        }
        text = self.client.get(PREC_SEARCH_URL, params=params)
        root = ET.fromstring(text)
        total = int(root.findtext("totalCnt") or "0")
        items = []
        for prec in root.findall(".//prec"):
            items.append({
                "id": _xml(prec, "판례일련번호"),
                "사건명": _xml(prec, "사건명"),
                "사건번호": _xml(prec, "사건번호"),
                "선고일자": _xml(prec, "선고일자"),
                "법원명": _xml(prec, "법원명"),
                "사건종류명": _xml(prec, "사건종류명"),
                "판결유형": _xml(prec, "판결유형"),
                "판시사항": _xml(prec, "판시사항"),
            })
        return total, items

    def _fetch_detail(self, prec_id: str) -> dict:
        params = {
            "OC": self.oc,
            "target": "prec",
            "type": "XML",
            "ID": prec_id,
        }
        try:
            text = self.client.get(PREC_DETAIL_URL, params=params)
            root = ET.fromstring(text)
            return {
                "판결요지": _strip(_xml(root, "판결요지")),
                "판시사항": _strip(_xml(root, "판시사항")),
                "참조조문": _xml(root, "참조조문"),
                "전문": _strip(_xml(root, "전문")),
            }
        except Exception as exc:
            logger.warning("[law_prec] detail failed %s: %s", prec_id, exc)
            return {}

    def _build_case(self, item: dict, detail: dict) -> TaxCase:
        case_num = item["사건번호"]
        title = item["사건명"]
        tax_cat = _infer_tax_category(title + " " + item["판시사항"])
        date = _date_normalise(item["선고일자"])
        law_refs = [
            a.strip()
            for a in re.split(r"[,，]", detail.get("참조조문", ""))
            if a.strip()
        ][:10]
        return TaxCase(
            case_id=f"law_prec_{case_num.replace(' ', '_')}",
            source="law_prec",
            source_url=f"https://www.law.go.kr/precInfoR.do?precSeq={item['id']}",
            case_number=case_num,
            title=title,
            tax_category=tax_cat,
            law_articles=law_refs,
            decision_date=date,
            decision_type=item.get("판결유형") or None,
            agency=item.get("법원명", ""),
            summary=detail.get("판결요지", "")[:500],
            full_text=detail.get("전문", ""),
            inquiry_agency=None,
        )

    def collect(self, queries: list[str] | None = None, fetch_detail: bool = True) -> list[TaxCase]:
        if not self.oc:
            logger.warning("LAW_OC_KEY not set — skipping law.go.kr prec collection")
            return []

        queries = queries or ["세금 부과", "국세 처분", "조세 부과", "납세의무"]
        seen: set[str] = set()
        cases: list[TaxCase] = []
        mp = config.MAX_PAGES or 10

        for query in queries:
            page = 1
            while page <= mp:
                logger.info("[law_prec] query='%s' page=%d", query, page)
                try:
                    total, items = self._search_page(query, page)
                except Exception as exc:
                    logger.error("[law_prec] search failed: %s", exc)
                    break
                if not items:
                    break
                for item in items:
                    pid = item["id"]
                    if pid in seen or not pid:
                        continue
                    seen.add(pid)
                    detail = self._fetch_detail(pid) if fetch_detail else {}
                    # Only keep tax-related cases
                    text = item["사건명"] + " " + item["판시사항"]
                    if _infer_tax_category(text) == "기타" and not fetch_detail:
                        continue
                    cases.append(self._build_case(item, detail))
                if page * 100 >= total or page >= mp:
                    break
                page += 1

        logger.info("[law_prec] collected %d cases", len(cases))
        return cases
