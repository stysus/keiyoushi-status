#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "aia",
#   "aiohttp[speedups]",
#   "beautifulsoup4[lxml]",
#   "dnspython[doh,idna]",
#   "httpx[http2]",
#   "publicsuffixlist",
#   "ua-generator",
#   "yarl",
# ]
# ///

"""Self-check for the pure classification helpers in common.py.

Run: uv run .github/scripts/test_classify.py
"""

from __future__ import annotations

import asyncio
import ssl

from common import Classification, Status, classify_exception, classify_response, is_retryable

_BODY = "".join(f"<p>line {i}</p>" for i in range(20))
PAGE = f"<html><head><title>Example</title></head><body>{_BODY}</body></html>"
URL = "https://x.test/"


def classify(
    html: str | None,
    *,
    status: int = 200,
    final_url: str = URL,
    headers: dict[str, str] | None = None,
    content_type: str = "text/html",
) -> Classification:
    return classify_response(
        status_code=status,
        final_url=final_url,
        content_type=content_type,
        headers=headers or {},
        html=html,
        original_url=URL,
    )


def main() -> None:
    cases: list[tuple[str, Classification, tuple[Status, str]]] = [
        ("ok", classify(PAGE), (Status.OK, "")),
        ("not found", classify(PAGE, status=404), (Status.NOT_FOUND, "HTTP 404")),
        ("rate limited", classify(PAGE, status=429), (Status.RATE_LIMITED, "HTTP 429")),
        (
            "cf iuam",
            classify("<html><head><title>Just a moment...</title></head><body></body></html>"),
            (Status.CF_IUAM, ""),
        ),
        (
            "cf block",
            classify("<html><head><title>Attention Required! | Cloudflare</title></head><body></body></html>"),
            (Status.CF_BLOCK, ""),
        ),
        (
            "ddos-guard",
            classify(PAGE, headers={"server": "ddos-guard"}),
            (Status.WAF, "DDoS-Guard"),
        ),
        (
            "parked body",
            classify("<html><head><title>X</title></head><body>buy this domain</body></html>"),
            (Status.PARKED, "Domain For Sale / Parked"),
        ),
        (
            "placeholder",
            classify("<html><head><title>Welcome to nginx!</title></head><body></body></html>"),
            (Status.PLACEHOLDER, "Default Server Page"),
        ),
        (
            "blank page",
            classify("<html><body><div></div></body></html>"),
            (Status.WARNING, "Blank Page"),
        ),
        (
            "spa shell",
            classify('<html><body><div id="root"></div><script src="/a.js"></script></body></html>'),
            (Status.OK, "JS-rendered (SPA)"),
        ),
        (
            "same-authority redirect",
            classify(PAGE, final_url="https://www.x.test/"),
            (Status.REDIRECT, "Same Authority"),
        ),
        (
            "cross-authority redirect",
            classify(PAGE, final_url="https://y.test/"),
            (Status.REDIRECT, ""),
        ),
        (
            "binary ok",
            classify(None, content_type="image/png"),
            (Status.OK, "Binary (image/png)"),
        ),
        (
            "cloudflare 522",
            classify(PAGE, status=522),
            (Status.WARNING, "Cloudflare 522 (Connection Timed Out)"),
        ),
        (
            "server error",
            classify(PAGE, status=503),
            (Status.WARNING, "Server Error (503)"),
        ),
    ]

    for name, got, want in cases:
        actual = (got.status, got.subcategory)
        assert actual == want, f"{name}: got {actual!r}, want {want!r}"

    exc_cases: list[tuple[str, Exception, tuple[Status, str]]] = [
        ("timeout", asyncio.TimeoutError(), (Status.ERROR, "Timeout")),
        ("dns", OSError(None, "DNS lookup failed for x.test"), (Status.DNS_ERROR, "DNS Failure")),
        ("generic", ValueError("boom"), (Status.ERROR, "ValueError")),
    ]
    for name, exc, want in exc_cases:
        got = classify_exception(exc)
        actual = (got.status, got.subcategory)
        assert actual == want, f"{name}: got {actual!r}, want {want!r}"

    retry_cases: list[tuple[str, Exception, bool]] = [
        ("timeout", asyncio.TimeoutError(), True),
        ("connection reset", ConnectionResetError(), True),
        ("ssl", ssl.SSLError(), False),
        ("generic", ValueError("boom"), False),
    ]
    for name, exc, want in retry_cases:
        got = is_retryable(exc)
        assert got is want, f"retry {name}: got {got!r}, want {want!r}"

    print(f"OK: {len(cases)} classification + {len(exc_cases)} exception + {len(retry_cases)} retry cases passed")


if __name__ == "__main__":
    main()
