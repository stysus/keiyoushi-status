"""Pure HTML/response classification and exception classification.

Turns a fetched response (or a fetch exception) into a `Status` plus a
subcategory and human-readable info, without performing any I/O, so it is
unit-testable in isolation from the DNS and HTTP transport.

Run:
    .github/scripts/test_classify.py
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus

from bs4 import BeautifulSoup
from publicsuffixlist import PublicSuffixList  # type: ignore[import-untyped]
from yarl import URL

psl = PublicSuffixList()

MIN_NODES_WARN = 20
PATTERN_WWSUB = re.compile(r"^ww\d+\.")


class Status(StrEnum):
    OK = "ok"
    ERROR = "error"
    WARNING = "warning"
    CF_BLOCK = "blocked"
    CF_IUAM = "iuam"
    WAF = "waf"
    RATE_LIMITED = "rate_limited"
    DNS_ERROR = "dns_error"
    REDIRECT = "redirect"
    PARKED = "parked"
    NOT_FOUND = "not_found"
    PLACEHOLDER = "placeholder"


META_REFRESH_CONTENT_RE = re.compile(r"url=['\"]?([^'\";\s]+)", re.IGNORECASE)
WINDOW_LOCATION_RE = re.compile(
    r"""(?:window|self|top)\.location(?:\.href\s*=\s*|\s*=\s*|\.replace\s*\(\s*)['"](https?://[^'"]+)['"]""",
    re.IGNORECASE,
)
TITLE_DOMAIN_PREFIX_RE = re.compile(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*[|:]\s*")
TITLE_STATUS_PREFIX_RE = re.compile(r"^(?:HTTP\s*)?\d{3}\s*[:\s-]\s*", re.IGNORECASE)
TITLE_ERROR_PREFIX_RE = re.compile(r"^ERROR:\s*", re.IGNORECASE)


def _clean_error_title(title: str, status_code: int, subcategory: str) -> str:
    if not title:
        return ""
    cleaned = TITLE_DOMAIN_PREFIX_RE.sub("", title).strip()
    cleaned = TITLE_STATUS_PREFIX_RE.sub("", cleaned).strip()
    cleaned = TITLE_ERROR_PREFIX_RE.sub("", cleaned).strip()
    cleaned = cleaned.rstrip(":").strip()

    if not cleaned:
        return ""

    if subcategory.startswith("Cloudflare 52"):
        return ""

    subcat_lower = subcategory.lower()
    cleaned_lower = cleaned.lower()
    if cleaned_lower in subcat_lower:
        return ""

    if cleaned_lower in {str(status_code), f"http {status_code}"}:
        return ""

    return cleaned


PARKED_DOMAINS = [
    "https://bulsis.net/",
    "https://expireddomains.com/",
    "https://teksishe.net/",
    "https://dan.com/",
    "https://sedo.com/",
    "https://afternic.com/",
    "https://hugedomains.com/",
    "https://bodis.com/",
    "https://parkingcrew.net/",
    "https://domainmarket.com/",
    "https://www.godaddy.com/domainsearch/",
]

PARKED_QUERIES = [
    "subid1",
]

PLACEHOLDER_TITLES = [
    "Apache2 Debian Default Page: It works",
    "Apache2 Ubuntu Default Page: It works",
    "Sorry, the website has been stopped",
    "Welcome to nginx!",
]

PLACEHOLDER_BODIES = [
    "site has been stopped by the administrator",
    "website has been stopped",
]

# Client-rendered shells look "blank" to a static fetch; do not flag them as broken.
SPA_MARKERS = (
    "__next_data__",
    "window.__nuxt__",
    "data-reactroot",
    "ng-version",
    'id="app"',
    "id='app'",
    'id="root"',
    "id='root'",
    'id="__next"',
)

PARKED_TITLES = [
    "Loading...",
    "Redirecting...",
    "Buy this domain",
    "This domain is for sale",
    "Domain Name for Sale",
    "Domain for Sale",
    "Inquire About This Domain",
    "Domain Parking",
    "Parking Page",
    "Domain Suspended",
    "Website Suspended",
    "Account Suspended",
]

PARKED_BODIES = [
    '''"/lander"''',
    '''"domainPrice"''',
    '''"domainRegistrant"''',
    """?tr_uuid=""",
    """'/saleform'""",
    """<h1>This domain is for sale</h1>""",
    """<html data-adblockkey=""",
    """<img src="https://l.cdn-fileserver.com/bping.php?""",
    """<p><a href="/_pp">Privacy Policy</a></p>""",
    """<script src="\\/\\/sedoparking.com/frmpark/""",
    """<script>window.park = "ey""",
    """1and1.com""",
    """parklogic.com""",
    """sedo.com/services/parking.php""",
    """sedoparking.com""",
    """window.location.href="/lander""",
    "buy this domain",
    "domain is for sale",
    "domain may be for sale",
    "inquire about this domain",
    "the domain has expired",
    "this domain has expired",
    "parked free courtesy of",
    "parked by godaddy",
    "parked by namecheap",
    "dan.com/buy-domain",
    "hugedomains.com/domain_profile",
    "parkingcrew.net",
    "bodis.com",
]

MAINTENANCE_TITLES = [
    "under maintenance",
    "maintenance mode",
    "site maintenance",
    "down for maintenance",
    "scheduled maintenance",
    "we'll be back soon",
]

DB_ERROR_PATTERNS = [
    "error establishing a database connection",
    "database connection error",
    "database error",
    "mysqli_connect",
    "pdoexception",
    "cannot select database",
]


def check_placeholder_content(title: str, html: str) -> list[str]:
    signals: list[str] = []
    if title in PLACEHOLDER_TITLES:
        signals.append("title")
    if any(body in html.lower() for body in PLACEHOLDER_BODIES):
        signals.append("body")
    return signals


def check_parked_redirect(redirected_url: URL) -> list[str]:
    signals: list[str] = []
    if redirected_url.scheme == "http" and PATTERN_WWSUB.match(str(redirected_url.host)):
        signals.append("scheme")
    if any(str(redirected_url).startswith(domain) for domain in PARKED_DOMAINS):
        signals.append("domain")
    if any(redirected_url.query.get(query) is not None for query in PARKED_QUERIES):
        signals.append("query")
    return signals


def check_parked_content(title: str, html: str) -> list[str]:
    signals: list[str] = []
    if title in PARKED_TITLES:
        signals.append("title")
    if any(body in html for body in PARKED_BODIES):
        signals.append("body")
    return signals


def is_same_authority(url_a: str, url_b: str) -> bool:
    host_a = psl.privatesuffix(URL(url_a).host or "")
    host_b = psl.privatesuffix(URL(url_b).host or "")
    return bool(host_a and host_a == host_b)


@dataclass(frozen=True, slots=True)
class Classification:
    """Pure outcome of inspecting a fetched response."""

    status: Status
    subcategory: str = ""
    info: str = ""


def classify_response(
    *,
    status_code: int,
    final_url: str,
    content_type: str,
    headers: Mapping[str, str],
    html: str | None,
    original_url: str,
) -> Classification:
    """Classify a fetched response without performing I/O (unit-testable).

    Returns:
        The classified status, subcategory, and human-readable info.
    """
    infos: list[str] = []
    parked_signals: list[str] = []

    def out(status: Status, subcategory: str = "") -> Classification:
        parts = infos.copy()
        if parked_signals:
            parts.append(f"Method: {', '.join(parked_signals)}")
        return Classification(status, subcategory, ". ".join(parts))

    if html is None:
        content_type = content_type.lower()
        infos.append(f"Non-HTML ({content_type})")
        if status_code == HTTPStatus.OK:
            return out(Status.OK, subcategory=f"Binary ({content_type})")
        return out(Status.WARNING, subcategory=f"Binary {status_code}")

    soup = BeautifulSoup(html, "lxml")

    node_count = len(soup.select("*"))

    # Compare parsed URLs, not string prefixes: a lookalike host such as
    # "example.com.evil.com" starts with "example.com" but is a different origin.
    redirected = URL(final_url) != URL(original_url)
    if redirected:
        infos.append(f"Redirected: {final_url}")
        parked_signals.extend(check_parked_redirect(URL(final_url)))

    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    title_lower = title.lower()
    html_lower = html.lower()
    server_header = headers.get("server", "").lower()

    # HTML Meta Refresh & JS Redirect Detection
    meta_refresh = soup.find("meta", attrs={"http-equiv": re.compile(r"^refresh$", re.IGNORECASE)})
    if (
        meta_refresh
        and (content_val := meta_refresh.get("content"))
        and (m := META_REFRESH_CONTENT_RE.search(content_val))
    ):
        target = m.group(1).strip()
        if not target.startswith(("http://", "https://")):
            target = str(URL(original_url).join(URL(target)))
        if target != original_url:
            infos.append(f"Meta Refresh -> {target}")
            subcat = "Same Authority (Meta)" if is_same_authority(original_url, target) else "Meta Refresh"
            return out(Status.REDIRECT, subcat)

    js_redirect_match = WINDOW_LOCATION_RE.search(html[:65536])
    if js_redirect_match:
        target = js_redirect_match.group(1).strip()
        if target != original_url:
            infos.append(f"JS Redirect -> {target}")
            subcat = "Same Authority (JS)" if is_same_authority(original_url, target) else "JS Redirect"
            return out(Status.REDIRECT, subcat)

    # 1. Cloudflare Challenges & Blocks
    if not redirected:
        if (
            title in {"Just a moment...", "Checking your browser...", "Verify you are human"}
            or "challenges.cloudflare.com" in html_lower
            or "cf-turnstile" in html_lower
            or "turnstile-wrapper" in html_lower
            or "cf-browser-verification" in html_lower
            or (
                "ray id:" in html_lower
                and ("verifying you are human" in html_lower or "enable javascript and cookies" in html_lower)
            )
        ):
            infos = []
            return out(Status.CF_IUAM)

        if (
            title == "Attention Required! | Cloudflare"
            or "attention required! | cloudflare" in title_lower
            or "error 1020" in html_lower
            or "error 1006" in html_lower
            or "error 1007" in html_lower
            or "sorry, you have been blocked" in html_lower
            or ("access denied" in html_lower and "cloudflare" in html_lower)
        ):
            infos = []
            return out(Status.CF_BLOCK)

    # 2. Third-Party WAF / DDoS-Guard / Sucuri / Imperva
    if (
        "ddos-guard" in server_header
        or "ddos-guard" in title_lower
        or "ddos protection by ddos-guard" in html_lower
        or "checking your browser before accessing" in html_lower
        or "check.ddos-guard.net" in html_lower
    ):
        return out(Status.WAF, subcategory="DDoS-Guard")

    if (
        "x-sucuri-id" in headers
        or "x-sucuri-cache" in headers
        or "sucuri website firewall" in html_lower
        or "access denied - sucuri" in title_lower
    ):
        return out(Status.WAF, subcategory="Sucuri WAF")

    if (
        "imperva" in headers.get("x-cdn", "").lower()
        or "_incapsula_resource" in html_lower
        or "incapsula incident id" in html_lower
        or "request unsuccessful. incapsula" in html_lower
    ):
        return out(Status.WAF, subcategory="Imperva WAF")

    if "security check" in title_lower or "challenge validation" in title_lower:
        return out(Status.WAF, subcategory="WAF Challenge")

    # 3. Rate Limiting (HTTP 429 / Error 1015)
    if status_code == HTTPStatus.TOO_MANY_REQUESTS or "rate limit" in title_lower or "error 1015" in title_lower:
        return out(Status.RATE_LIMITED, subcategory="HTTP 429" if status_code == 429 else "Rate Limited")

    # 4. HTTP 404 (Not Found)
    if status_code == HTTPStatus.NOT_FOUND:
        return out(Status.NOT_FOUND, subcategory="HTTP 404")

    # 5. Placeholders & Maintenance
    if check_placeholder_content(title, html):
        return out(Status.PLACEHOLDER, subcategory="Default Server Page")

    if any(m in title_lower for m in MAINTENANCE_TITLES) or ("under maintenance" in html_lower and node_count < 30):
        infos.append("Site under maintenance")
        return out(Status.PLACEHOLDER, subcategory="Maintenance")

    # 6. Parked / For Sale / Expired Domains
    parked_signals.extend(check_parked_content(title, html))
    if parked_signals:
        return out(Status.PARKED, subcategory="Domain For Sale / Parked")

    # 7. HTTP Redirects
    if redirected:
        subcategory = "Same Authority" if is_same_authority(original_url, final_url) else ""
        return out(Status.REDIRECT, subcategory)

    # 8. Operational (HTTP 200 OK) with False-Positive Checks
    if status_code == HTTPStatus.OK:
        # Check A: Blank page (few nodes and minimal text)
        body_text = soup.text.strip()
        if node_count < 6 and len(body_text) < 20:
            if any(marker in html_lower for marker in SPA_MARKERS):
                return out(Status.OK, subcategory="JS-rendered (SPA)")
            infos.append(f"Empty page ({node_count} nodes)")
            return out(Status.WARNING, subcategory="Blank Page")

        # Check B: Database connection error disguised as 200
        if any(db_err in html_lower for db_err in DB_ERROR_PATTERNS):
            infos.append("Database connection failure")
            return out(Status.WARNING, subcategory="Database Error")

        if node_count < MIN_NODES_WARN:
            infos.append(f"Few nodes ({node_count})")

        return out(Status.OK, subcategory="With Notes" if infos else "")

    # 9. Warnings with enriched subcategories
    if status_code in {520, 521, 522, 523, 524, 525, 526}:
        cf_subcat_map = {
            520: "Cloudflare 520 (Unknown Error)",
            521: "Cloudflare 521 (Server Down)",
            522: "Cloudflare 522 (Connection Timed Out)",
            523: "Cloudflare 523 (Origin Unreachable)",
            524: "Cloudflare 524 (Timeout)",
            525: "Cloudflare 525 (SSL Handshake Failed)",
            526: "Cloudflare 526 (Invalid SSL)",
        }
        subcategory = cf_subcat_map.get(status_code, f"Cloudflare {status_code}")
    elif 500 <= status_code < 600:
        subcategory = f"Server Error ({status_code})"
    elif status_code == HTTPStatus.FORBIDDEN:
        subcategory = "Forbidden (403)"
    else:
        subcategory = f"HTTP {status_code}"

    cleaned_msg = _clean_error_title(title, status_code, subcategory)
    if cleaned_msg:
        infos.append(cleaned_msg)

    return out(Status.WARNING, subcategory=subcategory)


RETRYABLE_CURL_CODES = frozenset({6, 7, 28, 52, 56})  # resolve/connect/timeout/empty-reply/recv
SSL_CURL_CODES = frozenset({35, 60})
REDIRECT_LOOP_CODE = 47
DNS_CURL_CODE = 6
TIMEOUT_CURL_CODE = 28


def _curl_code(e: Exception) -> int | None:
    code = getattr(e, "code", None)
    return code if isinstance(code, int) else None


def is_retryable(e: Exception) -> bool:
    """Report whether a fetch exception is worth retrying.

    Returns:
        True for transient curl network failures, False for deterministic errors.
    """
    return _curl_code(e) in RETRYABLE_CURL_CODES


def classify_exception(e: Exception) -> Classification:
    """Classify a curl_cffi fetch exception without performing I/O (unit-testable).

    Returns:
        The classified status, subcategory, and exception message.
    """
    code = _curl_code(e)
    if code == REDIRECT_LOOP_CODE:
        return Classification(Status.WARNING, "Redirect Loop", str(e))
    if code == DNS_CURL_CODE:
        return Classification(Status.DNS_ERROR, "DNS Failure", str(e))
    if code in SSL_CURL_CODES:
        return Classification(Status.ERROR, "SSL Error", str(e))
    if code == TIMEOUT_CURL_CODE or "timeout" in str(e).lower():
        return Classification(Status.ERROR, "Timeout", str(e))
    if code is not None:
        return Classification(Status.ERROR, "Connection Failed", str(e))
    return Classification(Status.ERROR, type(e).__name__, str(e))
