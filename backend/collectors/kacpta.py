"""
Collector: 한국세무사회 세무상담사례 (kacpta.or.kr)

The association publishes consultation Q&A through:
  1. 세무사신문 웹진 (http://webzine.kacpta.or.kr)
  2. 메인 사이트 공지/자료실 (https://www.kacpta.or.kr)

This collector scrapes the webzine archive for published 상담사례.
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
from collectors.nts_expc import _infer_tax_category

logger = logging.getLogger(__name__)

WEBZINE_SEARCH_URL = "http://webzine.kacpta.or.kr/"
KACPTA_BASE = "https://www.kacpta.or.kr"


class _ArticleListParser(HTMLParser):
    """Parse article list from webzine pages (generic link extractor)."""

    def __init__(self, base_url: str = ""):
        super().__init__()
        self.links: list[dict] = []
        self._base = base_url

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        attr_dict = dict(attrs)
        href = attr_dict.get("href", "")
        title = attr_dict.get("title", "")
        if href and ("상담" in title or "사례" in title or "질의" in title):
            full = href if href.startswith("http") else self._base + "/" + href.lstrip("/")
            self.links.append({"url": full, "title": title})

    def handle_data(self, data):
        pass


class _ArticleBodyParser(HTMLParser):
    """Extract main article text from a news/blog page."""

    def __init__(self):
        super().__init__()
        self._in_body = False
        self._depth = 0
        self._parts: list[str] = []
        self._title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        css = " ".join([attr_dict.get("class", ""), attr_dict.get("id", "")])
        if any(k in css for k in ("article", "content", "view", "body", "cont")):
            self._in_body = True
        if tag in ("h1", "h2", "h3") and not self._title:
            self._in_title = True

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3"):
            self._in_title = False

    def handle_data(self, data):
        d = data.strip()
        if not d:
            return
        if self._in_title and not self._title:
            self._title = d
        if self._in_body:
            self._parts.append(d)

    def get_text(self) -> str:
        return " ".join(self._parts)


class KacptaCollector:
    """
    Collects 세무상담사례 from 한국세무사회.

    Note: The webzine uses simple HTML and is straightforward to parse.
    The main kacpta.or.kr site may require login for some content.
    """

    def __init__(self):
        self.client = HttpClient(
            delay=config.REQUEST_DELAY,
            ssl_verify=config.SSL_VERIFY,
        )

    def _search_webzine(self, keyword: str, page: int = 1) -> list[dict]:
        """Search the webzine for articles mentioning the keyword."""
        try:
            html = self.client.get(
                WEBZINE_SEARCH_URL,
                params={"s": keyword, "paged": page},
            )
        except Exception as exc:
            logger.warning("[kacpta] webzine search failed for '%s': %s", keyword, exc)
            return []

        # Extract article links from search results
        parser = _ArticleListParser(base_url=WEBZINE_SEARCH_URL.rstrip("/"))
        parser.feed(html)

        # Also do a regex-based link extraction for robustness
        links = list(parser.links)
        for m in re.finditer(
            r'href="([^"]*(?:상담사례|질의|컨설팅|세무상담)[^"]*)"[^>]*>([^<]{5,100})',
            html,
        ):
            url, title = m.group(1), m.group(2).strip()
            if not url.startswith("http"):
                url = WEBZINE_SEARCH_URL.rstrip("/") + "/" + url.lstrip("/")
            links.append({"url": url, "title": title})

        return links

    def _fetch_article(self, url: str) -> dict:
        try:
            html = self.client.get(url)
            parser = _ArticleBodyParser()
            parser.feed(html)
            # Extract any date from the page
            date_match = re.search(
                r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|(\d{4})년\s*(\d{1,2})월",
                html,
            )
            date = ""
            if date_match:
                g = date_match.groups()
                if g[0]:
                    date = f"{g[0]}-{g[1].zfill(2)}-{g[2].zfill(2)}"
                elif g[3]:
                    date = f"{g[3]}-{g[4].zfill(2)}-01"
            return {
                "title": parser._title,
                "text": parser.get_text(),
                "date": date,
            }
        except Exception as exc:
            logger.warning("[kacpta] article fetch failed %s: %s", url, exc)
            return {}

    def collect(self, keywords: list[str] | None = None, max_pages: int = 5) -> list[TaxCase]:
        keywords = keywords or ["세무상담사례", "상담사례", "질의회신"]
        seen_urls: set[str] = set()
        cases: list[TaxCase] = []
        idx = 0

        for kw in keywords:
            for page in range(1, max_pages + 1):
                logger.info("[kacpta] keyword='%s' page=%d", kw, page)
                links = self._search_webzine(kw, page)
                if not links:
                    break
                for link in links:
                    url = link["url"]
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)
                    article = self._fetch_article(url)
                    if not article.get("text"):
                        continue

                    idx += 1
                    title = article.get("title") or link.get("title", f"사례_{idx}")
                    text = article["text"]
                    tax_cat = _infer_tax_category(title + " " + text[:300])

                    cases.append(TaxCase(
                        case_id=f"kacpta_{idx:04d}",
                        source="kacpta",
                        source_url=url,
                        case_number=f"KACPTA-{idx:04d}",
                        title=title,
                        tax_category=tax_cat,
                        law_articles=[],
                        decision_date=article.get("date", ""),
                        decision_type="상담회신",
                        agency="한국세무사회",
                        summary=text[:500],
                        full_text=text,
                        inquiry_agency=None,
                    ))

        logger.info("[kacpta] collected %d cases", len(cases))
        return cases
