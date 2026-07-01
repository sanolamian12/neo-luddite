"""
Configuration for the Korean tax case collection pipeline.

API keys:
  - LAW_OC_KEY: Get from https://open.law.go.kr/LSO/openApi/keyApplyView.do
  - DATA_GO_KR_KEY: Get from https://www.data.go.kr (조세심판원 행정심판 재결례 API)

Set as environment variables or fill in below.
"""

import os

# ── API Keys ────────────────────────────────────────────────────────────────

# 국가법령정보 공동활용 (open.law.go.kr)
# Used for: 법령해석례 목록/본문, 판례 목록/본문
LAW_OC_KEY = os.environ.get("LAW_OC_KEY", "choiyoojin")

# 공공데이터포털 (data.go.kr)
# Used for: 조세심판원 행정심판 재결례 목록/본문
DATA_GO_KR_KEY = os.environ.get("DATA_GO_KR_KEY", "")

# ── Output ──────────────────────────────────────────────────────────────────

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data")
RAW_DIR = os.path.join(OUTPUT_DIR, "raw")
PROCESSED_DIR = os.path.join(OUTPUT_DIR, "processed")

# ── Collection Settings ─────────────────────────────────────────────────────

# Seconds to wait between HTTP requests (be respectful to gov servers)
REQUEST_DELAY = 1.0

# Maximum pages to fetch per query (None = fetch all)
MAX_PAGES = None

# HTTP timeout in seconds
HTTP_TIMEOUT = 30

# Disable SSL verification for corporate proxies (set True with caution)
SSL_VERIFY = True

# ── Source: 법령해석례 (law.go.kr expc API) ──────────────────────────────────

EXPC_BASE_URL = "https://www.law.go.kr/DRF/lawSearch.do"
EXPC_DETAIL_URL = "https://www.law.go.kr/DRF/lawService.do"
EXPC_PAGE_SIZE = 100  # max allowed

# 세목 키워드 targets (add/remove as needed)
EXPC_QUERIES = [
    "소득세",
    "법인세",
    "부가가치세",
    "상속세",
    "증여세",
    "종합부동산세",
    "양도소득세",
    "원천징수",
    "가산세",
]

# ── Source: 조세심판원 (tt.go.kr scraping) ───────────────────────────────────

TT_BASE_URL = "https://www.tt.go.kr"
TT_MAIN_LIST_URL = "https://www.tt.go.kr/mUser/dem/mainDemList.do"
TT_SEMOK_LIST_URL = "https://www.tt.go.kr/mUser/dem/demList.do"
TT_DETAIL_URL = "https://www.tt.go.kr/mUser/dem/demDetail.do"

# 세목 코드 (from site URL patterns; 98=전체, others are specific)
TT_SEMOK_CODES = {
    "10": "소득세",
    "20": "법인세",
    "30": "부가가치세",
    "40": "상속세",
    "50": "증여세",
    "60": "양도소득세",
    "70": "종합부동산세",
    "80": "원천세",
    "98": "전체",
}

# 결정유형 코드
TT_JUDGE_CODES = {
    "S100": "인용",
    "S200": "기각",
    "S300": "각하",
    "S400": "재조사",
    "S500": "전체",
}

# ── Source: 국세법령정보시스템 (taxlaw.nts.go.kr scraping) ────────────────────

NTS_BASE_URL = "https://taxlaw.nts.go.kr"
NTS_LIST_URL = "https://taxlaw.nts.go.kr/qt/USEQTJ001M.do"
NTS_MONTHLY_URL = "https://taxlaw.nts.go.kr/qt/USEQTI001M.do"

# ── Source: 세무사회 / 회계사회 ──────────────────────────────────────────────

KACPTA_BASE_URL = "https://www.kacpta.or.kr"
KICPA_BASE_URL = "https://www.kicpa.or.kr"
