"""
Shared HTTP client using only stdlib (urllib).
Falls back to requests if available for better header/session handling.
"""

import json
import ssl
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

try:
    import requests as _requests
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False


_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate",
}


class HttpClient:
    def __init__(self, delay: float = 1.0, ssl_verify: bool = True, timeout: int = 30):
        self.delay = delay
        self.timeout = timeout
        self._last_request = 0.0

        if _HAS_REQUESTS:
            self._session = _requests.Session()
            self._session.headers.update(_DEFAULT_HEADERS)
            if not ssl_verify:
                self._session.verify = False
                import urllib3  # noqa
                urllib3.disable_warnings()
        else:
            cj = CookieJar()
            opener_args = [urllib.request.HTTPCookieProcessor(cj)]
            if not ssl_verify:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                opener_args.append(urllib.request.HTTPSHandler(context=ctx))
            self._opener = urllib.request.build_opener(*opener_args)
            self._opener.addheaders = list(_DEFAULT_HEADERS.items())

    def _throttle(self):
        elapsed = time.time() - self._last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request = time.time()

    def get(self, url: str, params: dict | None = None, headers: dict | None = None) -> str:
        self._throttle()
        if params:
            url = url + "?" + urllib.parse.urlencode(params, encoding="utf-8")

        if _HAS_REQUESTS:
            extra = headers or {}
            resp = self._session.get(url, headers=extra, timeout=self.timeout)
            resp.encoding = resp.apparent_encoding or "utf-8"
            return resp.text
        else:
            req = urllib.request.Request(url)
            if headers:
                for k, v in headers.items():
                    req.add_header(k, v)
            import gzip
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
                enc = resp.headers.get("Content-Encoding", "")
                if enc == "gzip":
                    raw = gzip.decompress(raw)
                charset = "utf-8"
                ct = resp.headers.get("Content-Type", "")
                if "charset=" in ct:
                    charset = ct.split("charset=")[-1].strip()
                return raw.decode(charset, errors="replace")

    def post(self, url: str, data: dict, headers: dict | None = None) -> str:
        self._throttle()
        post_data = urllib.parse.urlencode(data).encode("utf-8")

        if _HAS_REQUESTS:
            extra = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
            if headers:
                extra.update(headers)
            resp = self._session.post(url, data=data, headers=extra, timeout=self.timeout)
            resp.encoding = resp.apparent_encoding or "utf-8"
            return resp.text
        else:
            req = urllib.request.Request(url, data=post_data, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            if headers:
                for k, v in headers.items():
                    req.add_header(k, v)
            import gzip
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
                enc = resp.headers.get("Content-Encoding", "")
                if enc == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", errors="replace")

    def get_json(self, url: str, params: dict | None = None) -> dict | list:
        text = self.get(url, params=params, headers={"Accept": "application/json"})
        return json.loads(text)
