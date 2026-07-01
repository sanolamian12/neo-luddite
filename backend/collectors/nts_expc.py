"""
Collector: 국가법령정보 법령해석례 (open.law.go.kr expc API)
Covers NTS (국세청) and 기재부 유권해석 (서면질의, 사전답변, 예규).

API key (OC): https://open.law.go.kr/LSO/openApi/keyApplyView.do

Endpoint: https://www.law.go.kr/DRF/lawSearch.do  (list)
          https://www.law.go.kr/DRF/lawService.do  (detail)
"""

import logging
import re
import sys
import time
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from collectors.http_client import HttpClient
from collectors.schema import TaxCase

logger = logging.getLogger(__name__)


class _TextStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data):
        self._parts.append(data)

    def get_text(self):
        return " ".join(p.strip() for p in self._parts if p.strip())


def _strip_html(html: str) -> str:
    p = _TextStripper()
    p.feed(html)
    return p.get_text()


def _xml_text(elem, tag: str, default: str = "") -> str:
    node = elem.find(tag)
    return (node.text or "").strip() if node is not None else default


def _date_normalise(raw: str) -> str:
    """Convert 20230115 → 2023-01-15; return raw if already formatted."""
    raw = raw.strip()
    if re.fullmatch(r"\d{8}", raw):
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return raw


class NtsExpcCollector:
    """
    Fetches 법령해석례 from law.go.kr XML API.
    Requires a valid OC key in config.LAW_OC_KEY.
    """

    def __init__(self):
        self.client = HttpClient(delay=config.REQUEST_DELAY, ssl_verify=config.SSL_VERIFY)
        self.oc = config.LAW_OC_KEY

    def _fetch_list_page(self, query: str, page: int) -> tuple[int, list[dict]]:
        """Returns (total_count, list of item dicts)."""
        params = {
            "OC": self.oc,
            "target": "expc",
            "type": "XML",
            "query": query,
            "display": config.EXPC_PAGE_SIZE,
            "page": page,
            "sort": "ddes",  # newest first
        }
        text = self.client.get(config.EXPC_BASE_URL, params=params)
        root = ET.fromstring(text)

        total = int(root.findtext("totalCnt") or "0")
        items = []
        for item in root.findall(".//expc"):
            # Real DB ID is in <법령해석례일련번호> child element (e.g. "311721")
            # The id="" attribute is just page ordinal (1,2,3...) — do NOT use it
            expc_id = _xml_text(item, "법령해석례일련번호")
            items.append({
                "id": expc_id,
                "안건명": _xml_text(item, "안건명"),
                "안건번호": _xml_text(item, "안건번호"),
                "질의기관명": _xml_text(item, "질의기관명"),
                "회신기관명": _xml_text(item, "회신기관명"),
                "회신일자": _xml_text(item, "회신일자"),
            })
        return total, items

    def _fetch_detail(self, expc_id: str) -> dict:
        """Fetch full text and extra fields for one case."""
        params = {
            "OC": self.oc,
            "target": "expc",
            "type": "XML",
            "ID": expc_id,
        }
        try:
            text = self.client.get(config.EXPC_DETAIL_URL, params=params)
            root = ET.fromstring(text)
            return {
                # Actual field names from API response
                "질의요지": _strip_html(_xml_text(root, "질의요지")),
                "회답": _strip_html(_xml_text(root, "회답")),
                "이유": _strip_html(_xml_text(root, "이유")),
                "해석일자": _xml_text(root, "해석일자"),
                "해석기관명": _xml_text(root, "해석기관명"),
                "질의기관명": _xml_text(root, "질의기관명"),
            }
        except Exception as exc:
            logger.warning("Detail fetch failed for %s: %s", expc_id, exc)
            return {}

    def _list_to_case(self, item: dict, detail: dict) -> TaxCase:
        case_num = item["안건번호"] or item["id"]
        agency = detail.get("해석기관명") or item["회신기관명"] or "국세청"
        inq = detail.get("질의기관명") or item["질의기관명"] or None

        # Derive tax_category from title + case number
        tax_cat = _infer_tax_category(item["안건명"] + " " + case_num)

        # Use date from detail if available (more precise: YYYYMMDD format)
        date_raw = detail.get("해석일자") or item["회신일자"]

        full_text = "\n\n".join(filter(None, [
            detail.get("질의요지", ""),
            detail.get("회답", ""),
            detail.get("이유", ""),
        ]))

        return TaxCase(
            case_id=f"law_expc_{case_num.replace(' ', '_')}",
            source="law_expc",
            source_url=f"https://www.law.go.kr/expcInfoR.do?expcSeq={item['id']}",
            case_number=case_num,
            title=item["안건명"],
            tax_category=tax_cat,
            law_articles=[],
            decision_date=_date_normalise(date_raw),
            decision_type="회신",
            agency=agency,
            summary=detail.get("회답", "")[:500],
            full_text=full_text,
            inquiry_agency=inq,
        )

    def collect(self, queries: list[str] | None = None, fetch_detail: bool = True) -> list[TaxCase]:
        if not self.oc:
            logger.warning("LAW_OC_KEY not set — skipping law.go.kr expc collection")
            return []

        queries = queries or config.EXPC_QUERIES
        seen_ids: set[str] = set()
        cases: list[TaxCase] = []

        for query in queries:
            logger.info("[nts_expc] query='%s'", query)
            page = 1
            while True:
                try:
                    total, items = self._fetch_list_page(query, page)
                except Exception as exc:
                    logger.error("[nts_expc] list page %d failed: %s", page, exc)
                    break

                if not items:
                    break

                for item in items:
                    expc_id = item["id"]
                    if expc_id in seen_ids:
                        continue
                    seen_ids.add(expc_id)

                    detail = self._fetch_detail(expc_id) if fetch_detail else {}
                    case = self._list_to_case(item, detail)
                    cases.append(case)

                max_pages = config.MAX_PAGES or 9999
                if page * config.EXPC_PAGE_SIZE >= total or page >= max_pages:
                    break
                page += 1

        logger.info("[nts_expc] collected %d cases", len(cases))
        return cases


_TAX_KEYWORDS = {
    "소득세": ["소득세", "종합소득", "근로소득", "사업소득"],
    "법인세": ["법인세", "법인"],
    "부가가치세": ["부가가치세", "부가세", "매입세액", "영세율"],
    "상속세": ["상속세", "상속"],
    "증여세": ["증여세", "증여"],
    "종합부동산세": ["종합부동산세", "종부세"],
    "양도소득세": ["양도소득세", "양도세", "양도"],
    "원천세": ["원천징수", "원천세"],
    "가산세": ["가산세"],
}


def _infer_tax_category(text: str) -> str:
    for cat, keywords in _TAX_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return cat
    return "기타"
