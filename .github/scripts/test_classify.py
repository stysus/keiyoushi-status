#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "beautifulsoup4[lxml]",
#   "publicsuffixlist",
#   "yarl",
# ]
# ///

"""Self-check for the pure classification helpers in classify.py.

Run: uv run .github/scripts/test_classify.py
"""

from __future__ import annotations

from classify import Classification, Status, classify_exception, classify_response, is_retryable

_BODY = "".join(f"<p>line {i}</p>" for i in range(20))
PAGE = f"<html><head><title>Example</title></head><body>{_BODY}</body></html>"
URL = "https://x.test/"


class FakeCurlError(Exception):
    """Minimal stand-in for a curl_cffi error: only `.code` drives classification."""

    def __init__(self, code: int) -> None:
        super().__init__(f"curl error {code}")
        self.code = code


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
            "same-authority path redirect",
            classify(PAGE, final_url="https://x.test/login"),
            (Status.REDIRECT, "Same Authority"),
        ),
        (
            "lookalike host redirect",
            classify(PAGE, final_url="https://x.test.evil.test/"),
            (Status.REDIRECT, ""),
        ),
        (
            "trailing-slash only is not a redirect",
            classify(PAGE, final_url="https://x.test"),
            (Status.OK, ""),
        ),
        (
            "binary ok",
            classify(None, content_type="image/png"),
            (Status.OK, "Binary (image/png)"),
        ),
        (
            "binary missing content-type",
            classify(None, content_type=""),
            (Status.OK, "Binary ()"),
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
        ("dns", FakeCurlError(6), (Status.DNS_ERROR, "DNS Failure")),
        ("timeout", FakeCurlError(28), (Status.ERROR, "Timeout")),
        ("ssl", FakeCurlError(60), (Status.ERROR, "SSL Error")),
        ("redirect loop", FakeCurlError(47), (Status.WARNING, "Redirect Loop")),
        ("connection", FakeCurlError(7), (Status.ERROR, "Connection Failed")),
        ("plain timeout message", TimeoutError("operation timeout"), (Status.ERROR, "Timeout")),
        ("generic", ValueError("boom"), (Status.ERROR, "ValueError")),
    ]
    for name, exc, want in exc_cases:
        got = classify_exception(exc)
        actual = (got.status, got.subcategory)
        assert actual == want, f"{name}: got {actual!r}, want {want!r}"

    retry_cases: list[tuple[str, Exception, bool]] = [
        ("dns", FakeCurlError(6), True),
        ("connect", FakeCurlError(7), True),
        ("timeout", FakeCurlError(28), True),
        ("empty reply", FakeCurlError(52), True),
        ("ssl cert", FakeCurlError(60), False),
        ("redirect loop", FakeCurlError(47), False),
        ("generic", ValueError("boom"), False),
    ]
    for name, exc, want in retry_cases:
        got = is_retryable(exc)
        assert got is want, f"retry {name}: got {got!r}, want {want!r}"

    print(f"OK: {len(cases)} classification + {len(exc_cases)} exception + {len(retry_cases)} retry cases passed")


if __name__ == "__main__":
    main()
