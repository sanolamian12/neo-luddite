"""
Collector: 조세심판원 심판결정례 (tt.go.kr web scraping)

Actual page structure (confirmed by inspection):
  - Results are in <li class="result-box"> cards (not tables)
  - Each card has:
      .label-decision   — 기각/인용/각하/재조사
      hidden <a>        — title (제목)
      .result-txt <a>   — summary text
      .info .date       — 결정일
      .info .case-num   — 청구번호
  - Detail URL: /mUser/dem/demView.do?semok=XX&dem_no=XXXXX
  - Main list detail: /mUser/dem/mainDemView.do?board_num=XXXXX
"""

import logging
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from collectors.http_client import HttpClient
from collectors.schema import TaxCase

logger = logging.getLogger(__name__)

# Actual semok codes from site navigation
TT_SEMOK_LABELS = {
    "20": "법인세",
    "12": "소득세",
    "50": "부가가치세",
    "11": "양도소득세",
    "40": "상속·증여세",
    "90": "관세",
    "99": "기타",
    "95": "지방세",
}

# Decision type label text → normalised name
TT_DECISION_LABELS = {
    "기각": "기각",
    "인용": "인용",
    "각하": "각하",
    "재조사": "재조사",
    "취소": "취소",
    "경정": "경정",
}


def _strip_tags(html: str) -> str:
    class S(HTMLParser):
        parts: list[str] = []
        def __init__(self): super().__init__(); self.parts = []
        def handle_data(self, d): self.parts.append(d)
    s = S(); s.feed(html); return " ".join(p.strip() for p in s.parts if p.strip())


def _norm_date(raw: str) -> str:
    raw = raw.strip()
    m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    m = re.fullmatch(r"(\d{8})", raw.replace("-", "").replace(".", ""))
    if m:
        s = m.group(1)
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return raw


def _clean(text: str) -> str:
    """Strip HTML tags, collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_cards(html: str) -> list[dict]:
    """
    Parse the result-box cards from the semok list and main list pages.
    Returns list of dicts with keys: dem_no, semok, title, summary, decision_type, date, case_number.
    """
    items = []
    # Each result card is wrapped in <li class="result-box">...</li>
    card_re = re.compile(r'<li[^>]+class="result-box[^"]*"[^>]*>(.*?)</li>', re.DOTALL)

    for card_match in card_re.finditer(html):
        card = card_match.group(1)

        # Extract dem_no and semok from the href
        dem_no, semok = "", ""
        href_m = re.search(r'demView\.do[^"]*dem_no=(\d+)[^"]*semok=(\d+)|semok=(\d+)[^"]*dem_no=(\d+)', card)
        if href_m:
            if href_m.group(1):
                dem_no, semok = href_m.group(1), href_m.group(2)
            else:
                dem_no, semok = href_m.group(4), href_m.group(3)
        else:
            # Try any demView href
            href_m2 = re.search(r'dem_no=(\d+)', card)
            semok_m = re.search(r'semok=(\d+)', card)
            if href_m2:
                dem_no = href_m2.group(1)
            if semok_m:
                semok = semok_m.group(1)

        if not dem_no:
            continue

        # Decision type from label-decision
        decision_m = re.search(r'label-decision[^>]*>([^<]+)<', card)
        decision_type = decision_m.group(1).strip() if decision_m else ""
        decision_type = TT_DECISION_LABELS.get(decision_type, decision_type)

        # Title from hidden <a style="display: none;">
        title = ""
        hidden_m = re.search(r'<a\s+style="display:\s*none;"[^>]*>([^<]+)<', card)
        if hidden_m:
            title = _clean(hidden_m.group(1))
        # Fallback: first non-empty <a> text
        if not title:
            all_a = re.findall(r'<a[^>]*>([^<]{10,200})<', card)
            if all_a:
                title = _clean(all_a[0])

        # Summary from result-txt <a>
        summary = ""
        result_txt_m = re.search(r'class="result-txt"[^>]*>(.*?)</div>', card, re.DOTALL)
        if result_txt_m:
            inner = result_txt_m.group(1)
            # Get the visible <a> (not the hidden one)
            summ_links = re.findall(r'<a[^>]*>(.+?)</a>', inner, re.DOTALL)
            for sl in summ_links:
                cleaned = _clean(sl)
                if len(cleaned) > 20:
                    summary = cleaned[:800]
                    break

        # Date
        date = ""
        date_m = re.search(r'class="date"[^>]*>.*?<span>[^<]+</span>\s*([\d\-\.]+)', card, re.DOTALL)
        if date_m:
            date = _norm_date(date_m.group(1))

        # Case number (청구번호)
        case_num = ""
        cn_m = re.search(r'class="case-num"[^>]*>.*?<span>[^<]+</span>\s*([^\n<]+)', card, re.DOTALL)
        if cn_m:
            case_num = cn_m.group(1).strip()

        items.append({
            "dem_no": dem_no,
            "semok": semok,
            "title": title,
            "summary": summary,
            "decision_type": decision_type,
            "date": date,
            "case_number": case_num,
        })

    return items


def _parse_main_cards(html: str) -> list[dict]:
    """
    Parse the 주요심판결정례 list page (uses board_num instead of dem_no).
    Columns: 번호 | 제목 (link) | 조회 | 등록일
    """
    items = []
    row_re = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL)
    for row in row_re.finditer(html):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row.group(1), re.DOTALL)
        if len(cells) < 3:
            continue
        # Look for board_num link in any cell
        href_m = re.search(r'href="([^"]*board_num=(\d+)[^"]*)"', row.group(1))
        if not href_m:
            continue
        board_num = href_m.group(2)
        # Title is the <a> text
        title_m = re.search(r'<a[^>]*>([^<]{5,300})</a>', cells[1] if len(cells) > 1 else row.group(1))
        title = _clean(title_m.group(1)) if title_m else ""
        # Date (last cell usually)
        date_m = re.search(r"(\d{4}-\d{2}-\d{2})", cells[-1])
        date = date_m.group(1) if date_m else ""

        if not title or "제목" in title:
            continue

        items.append({
            "board_num": board_num,
            "title": title,
            "date": date,
            "decision_type": "",
            "case_number": "",
            "summary": "",
            "semok": "",
        })

    return items


class _DetailParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in_dl = False
        self._in_dt = False
        self._in_dd = False
        self._key = ""
        self._val: list[str] = []
        self.fields: dict[str, str] = {}
        self._content_parts: list[str] = []
        self._in_content = False
        self._content_depth = 0

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        css = attr_dict.get("class", "")
        if any(k in css for k in ("view-con", "result-area", "con_area", "board-detail")):
            self._in_content = True
            self._content_depth = 0
        if self._in_content:
            self._content_depth += 1
        if tag == "dl":
            self._in_dl = True
        if self._in_dl and tag == "dt":
            self._in_dt = True; self._key = ""
        if self._in_dl and tag == "dd":
            self._in_dd = True; self._val = []

    def handle_endtag(self, tag):
        if tag == "dt": self._in_dt = False
        if tag == "dd":
            self._in_dd = False
            if self._key:
                self.fields[self._key.strip()] = " ".join(self._val).strip()
        if tag == "dl": self._in_dl = False
        if self._in_content:
            self._content_depth -= 1
            if self._content_depth <= 0:
                self._in_content = False

    def handle_data(self, data):
        d = data.strip()
        if not d: return
        if self._in_dt: self._key += d
        elif self._in_dd: self._val.append(d)
        if self._in_content: self._content_parts.append(d)

    def full_text(self) -> str:
        return " ".join(self._content_parts)


def _infer_tax_category(text: str, semok: str = "") -> str:
    if semok in TT_SEMOK_LABELS:
        return TT_SEMOK_LABELS[semok]
    mapping = {
        "소득세": ["소득세", "종합소득"],
        "법인세": ["법인세"],
        "부가가치세": ["부가가치세", "부가세"],
        "상속세": ["상속세"],
        "증여세": ["증여세"],
        "상속·증여세": ["상속", "증여"],
        "종합부동산세": ["종합부동산세", "종부세"],
        "양도소득세": ["양도소득세", "양도세", "양도"],
        "원천세": ["원천징수", "원천세"],
        "가산세": ["가산세"],
        "관세": ["관세"],
        "지방세": ["지방세", "취득세", "등록세"],
    }
    for cat, kws in mapping.items():
        if any(kw in text for kw in kws):
            return cat
    return "기타"


class TribunalCollector:
    def __init__(self):
        self.client = HttpClient(delay=config.REQUEST_DELAY, ssl_verify=config.SSL_VERIFY)
        self.base = config.TT_BASE_URL

    def _fetch_detail(self, dem_no: str, semok: str) -> dict:
        """
        The detail page embeds an iframe at /mUser/common/xmlViewer.do?dem_no=X&db=s
        which contains the full structured decision text. Fetch that directly.
        """
        iframe_url = f"{self.base}/mUser/common/xmlViewer.do"
        try:
            html = self.client.get(iframe_url, params={"dem_no": dem_no, "db": "s"})

            # Extract text from the #xmlData div
            idx = html.find('id="xmlData"')
            if idx < 0:
                idx = html.find("xmlData")
            xml_section = html[idx:] if idx >= 0 else html

            class _S(HTMLParser):
                parts: list[str] = []
                def __init__(self): super().__init__(); self.parts = []
                def handle_data(self, d):
                    if d.strip(): self.parts.append(d.strip())

            s = _S()
            s.feed(xml_section)
            raw_lines = s.parts

            # Parse bracketed section markers like [청구번호], [결정요지], etc.
            fields: dict[str, list[str]] = {}
            current_key = "header"
            for line in raw_lines:
                # Detect section markers like [청구번호], [세    목], etc.
                m = re.match(r"^\[([^\]]{2,20})\]$", line.replace("\xa0", "").strip())
                if m:
                    current_key = m.group(1).replace(" ", "").replace("　", "")
                    fields.setdefault(current_key, [])
                else:
                    if "---" in line:  # Skip separator lines
                        continue
                    fields.setdefault(current_key, []).append(line)

            def join(key: str) -> str:
                return " ".join(fields.get(key, [])).strip()

            full_text = "\n".join(s.parts)

            return {
                "full_text": full_text,
                "fields": {k: " ".join(v) for k, v in fields.items()},
                "case_number": join("청구번호").split("(")[0].strip(),
                "decision_type": join("결정유형"),
                "tax_category": join("세목"),
                "decision_summary": join("결정요지"),
                "related_laws": join("관련법령"),
                "order": join("주문"),
                "reasoning": join("이유"),
            }
        except Exception as exc:
            logger.warning("[tribunal] detail fetch failed dem_no=%s: %s", dem_no, exc)
            return {}

    def _fetch_main_detail(self, board_num: str) -> dict:
        url = f"{self.base}/mUser/dem/mainDemView.do"
        try:
            html = self.client.get(url, params={"board_idx": "case", "board_num": board_num})
            p = _DetailParser()
            p.feed(html)
            return {"full_text": p.full_text(), "fields": p.fields}
        except Exception as exc:
            logger.warning("[tribunal] main detail failed board_num=%s: %s", board_num, exc)
            return {}

    def _card_to_case(self, item: dict, detail: dict) -> TaxCase:
        dem_no = item.get("dem_no", "")
        board_num = item.get("board_num", "")

        case_num = (
            detail.get("case_number")
            or item.get("case_number")
            or detail.get("fields", {}).get("청구번호", "")
        )
        title = item.get("title", "") or detail.get("fields", {}).get("제목", "")

        # Prefer detail-derived fields (more accurate from full document)
        semok = item.get("semok", "")
        detail_tax = detail.get("tax_category", "").replace(" ", "")
        tax_cat = _infer_tax_category(detail_tax or title, semok)

        decision = (
            detail.get("decision_type")
            or item.get("decision_type")
            or ""
        )
        decision = TT_DECISION_LABELS.get(decision.strip(), decision.strip()) or None

        summary = (
            detail.get("decision_summary")
            or item.get("summary")
            or detail.get("fields", {}).get("결정요지", "")
        )[:500]

        # Law articles from related_laws field
        law_articles = [
            a.strip()
            for a in re.split(r"[/\n]", detail.get("related_laws", ""))
            if a.strip() and len(a.strip()) > 3
        ]

        if dem_no:
            url = f"{self.base}/mUser/dem/demView.do?dem_no={dem_no}&semok={semok}"
            case_id = f"tribunal_{case_num.replace(' ', '_') or dem_no}"
        else:
            url = f"{self.base}/mUser/dem/mainDemView.do?board_num={board_num}"
            case_id = f"tribunal_main_{board_num}"

        return TaxCase(
            case_id=case_id,
            source="tribunal",
            source_url=url,
            case_number=case_num,
            title=title,
            tax_category=tax_cat,
            law_articles=law_articles,
            decision_date=item.get("date", ""),
            decision_type=decision,
            agency="조세심판원",
            summary=summary,
            full_text=detail.get("full_text", ""),
            inquiry_agency=None,
        )

    # ── Public API ──────────────────────────────────────────────────────────

    def collect_main(self, max_pages: int | None = None) -> list[TaxCase]:
        cases: list[TaxCase] = []
        seen: set[str] = set()
        page = 1
        mp = max_pages or config.MAX_PAGES or 50

        while page <= mp:
            logger.info("[tribunal/main] page %d", page)
            try:
                html = self.client.get(
                    f"{self.base}/mUser/dem/mainDemList.do",
                    params={"pageNumber": page, "cbSearchOption": "subject"},
                )
            except Exception as exc:
                logger.error("[tribunal/main] page %d: %s", page, exc)
                break

            items = _parse_main_cards(html)
            if not items:
                break

            for item in items:
                bn = item["board_num"]
                if bn in seen:
                    continue
                seen.add(bn)
                detail = self._fetch_main_detail(bn)
                cases.append(self._card_to_case(item, detail))

            page += 1

        logger.info("[tribunal/main] %d cases", len(cases))
        return cases

    def collect_by_semok(
        self,
        semok_codes: list[str] | None = None,
        judge_code: str = "S500",
        max_pages_per_semok: int = 10,
    ) -> list[TaxCase]:
        semok_codes = semok_codes or list(TT_SEMOK_LABELS.keys())
        cases: list[TaxCase] = []
        seen: set[str] = set()

        for semok in semok_codes:
            page = 1
            label = TT_SEMOK_LABELS.get(semok, semok)
            while page <= max_pages_per_semok:
                logger.info("[tribunal/%s] page %d", label, page)
                try:
                    html = self.client.get(
                        f"{self.base}/mUser/dem/demList.do",
                        params={
                            "pageNumber": page,
                            "semok": semok,
                            "cbJudge": judge_code,
                            "cbSearchOption": "subject",
                        },
                    )
                except Exception as exc:
                    logger.error("[tribunal/%s] page %d: %s", label, page, exc)
                    break

                items = _parse_cards(html)
                if not items:
                    break

                for item in items:
                    dn = item["dem_no"]
                    if dn in seen:
                        continue
                    seen.add(dn)
                    detail = self._fetch_detail(dn, item.get("semok", semok))
                    cases.append(self._card_to_case(item, detail))

                page += 1

        logger.info("[tribunal/semok] %d cases", len(cases))
        return cases
