#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["beautifulsoup4[lxml]", "curl_cffi==0.16.3", "publicsuffixlist", "yarl"]
# ///
#
# Self-check for the transport helpers. No network: it exercises
# retry-classification, Retry-After parsing, the per-host limiter, and the
# DoH-rotation / attempt-counting loop against a scripted fake session.
#
# Run via: .github/scripts/test_transport.py

from __future__ import annotations

import asyncio
import math
from collections.abc import AsyncIterator

import transport
from curl_cffi.requests import exceptions as curl_exc

retry_after = transport._retry_after_seconds  # noqa: SLF001
host_semaphore = transport._host_semaphore  # noqa: SLF001


class FakeCurlError(Exception):
    """Stand-in for a curl_cffi error: only `.code` drives retry/DNS logic."""

    def __init__(self, code: int) -> None:
        super().__init__(f"curl error {code}")
        self.code = code


class FakeResponse:
    """Streaming-shaped response: yields one chunk and records being closed."""

    def __init__(self, *, body: bytes | None = None, content_type: str = "text/html") -> None:
        self.status_code = 200
        self.url = "https://a.test/"
        self.encoding = "utf-8"
        self.headers = {"content-type": content_type}
        self._body = (
            body
            if body is not None
            else b"<html><head><title>T</title></head><body>" + b"<p>x</p>" * 20 + b"</body></html>"
        )
        self.closed = False

    async def aiter_content(self, chunk_size: int | None = None) -> AsyncIterator[bytes]:
        yield self._body

    async def aclose(self) -> None:
        self.closed = True


class FakeSession:
    """Minimal AsyncSession: pops scripted results, or always raises one error."""

    def __init__(self, *, script: list[object] | None = None, always: Exception | None = None) -> None:
        self._script = list(script or [])
        self._always = always
        self.calls: list[str | None] = []

    async def get(self, url: str, *, doh_url: str | None = None, **_kwargs: object) -> FakeResponse:
        self.calls.append(doh_url)
        if self._always is not None:
            raise self._always
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


async def _rotation_test() -> None:
    # first DoH candidate fails to resolve, second succeeds: no retry consumed
    session = FakeSession(script=[FakeCurlError(6), FakeResponse()])
    res = await transport.check_url_generic(session, "https://a.test/", lambda c: c)
    assert res.status == transport.Status.OK, res
    assert res.attempts == 1, res.attempts
    assert session.calls[0] != session.calls[1]  # rotated to another nameserver


async def _all_dns_test() -> None:
    session = FakeSession(always=FakeCurlError(6))
    res = await transport.check_url_generic(session, "https://a.test/", lambda c: c)
    assert res.status == transport.Status.DNS_ERROR, res
    assert res.attempts == 3, res.attempts
    assert session.calls[-1] is None  # each attempt ends on the system-resolver fallback


async def _body_cap_test() -> None:
    # a body larger than the cap is truncated, never buffered whole, and closed
    resp = FakeResponse(body=b"<html><body>" + b"a" * (transport.MAX_BODY_BYTES * 2))
    session = FakeSession(script=[resp])
    snap = await transport._fetch_snapshot(session, "https://a.test/")  # noqa: SLF001
    assert snap.html is not None
    assert len(snap.html) <= transport.MAX_BODY_BYTES, len(snap.html)
    assert resp.closed


async def _binary_test() -> None:
    # Review Focus 4: a non-HTML body yields html=None without reading or raising
    resp = FakeResponse(body=b"\x89PNG\r\n\x1a\n", content_type="image/png")
    session = FakeSession(script=[resp])
    snap = await transport._fetch_snapshot(session, "https://a.test/")  # noqa: SLF001
    assert snap.html is None
    assert snap.content_type == "image/png"
    assert resp.closed


def _curl_exception_contract() -> None:
    # Pin the real curl_cffi API that classify.py duck-types: a genuine error
    # carries `.code` as an int. If upstream renames or retypes it, every fetch
    # error would silently degrade to the type-name branch; this fails loudly.
    dns = curl_exc.DNSError("could not resolve host: x.test", code=6)
    assert isinstance(dns.code, int), type(dns.code)
    assert transport.classify_exception(dns).status == transport.Status.DNS_ERROR
    assert transport.is_retryable(dns)
    assert not transport.is_retryable(curl_exc.SSLError("cert", code=60))


def main() -> None:
    assert transport.is_retryable_status(500)
    assert transport.is_retryable_status(429)
    assert not transport.is_retryable_status(403)
    assert not transport.is_retryable_status(404)

    # Review Focus 2: absurd Retry-After is capped
    assert math.isclose(retry_after({"retry-after": "99999"}), 5.0)
    assert math.isclose(retry_after({"retry-after": "2"}), 2.0)
    assert retry_after({}) is None
    assert retry_after({"retry-after": "soon"}) is None

    # Review Focus 5: same host -> same semaphore, distinct hosts -> distinct
    assert host_semaphore("a.test") is host_semaphore("a.test")
    assert host_semaphore("a.test") is not host_semaphore("b.test")
    assert host_semaphore("a.test")._value == 3  # noqa: SLF001

    _curl_exception_contract()
    asyncio.run(_rotation_test())
    asyncio.run(_all_dns_test())
    asyncio.run(_body_cap_test())
    asyncio.run(_binary_test())

    print("transport selftest OK")


if __name__ == "__main__":
    main()
