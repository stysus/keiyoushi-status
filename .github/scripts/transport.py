"""HTTP transport: DoH DNS, fetching, retries, and concurrency.

Owns the I/O side of a source check: a per-TLD DoH router feeding curl_cffi's
browser-impersonating session, the fetch-and-retry loop, and the `UrlCheck`
result handed to each check script's result factory. Classification itself
lives in `classify.py`.

Run: imported by check_extensions.py / check_issues.py.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar
from urllib.parse import urlsplit

from classify import (
    DNS_CURL_CODE,
    Classification,
    Status,
    classify_exception,
    classify_response,
    is_retryable,
)
from curl_cffi import AsyncSession
from curl_cffi.const import CurlOpt
from curl_cffi.requests import Response
from dns import DNS_MAX_ATTEMPTS, DoHRouter

log = logging.getLogger(__name__)

TIMEOUT_TOTAL_SECONDS = 45
MAX_CONCURRENT = 80
PER_HOST_LIMIT = 3
TIME_PRECISION_CUTOFF_SECONDS = 10
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 0.5
RETRY_AFTER_CAP_SECONDS = 5.0

IMPERSONATE = "chrome"
USER_AGENT_LABEL = "chrome (curl_cffi)"

_router = DoHRouter()
_host_semaphores: dict[str, asyncio.Semaphore] = {}


def create_session() -> AsyncSession:
    """Build the shared session: chrome TLS/JA3 fingerprint over HTTP/2.

    Returns:
        A configured `curl_cffi` async session.
    """
    return AsyncSession(
        impersonate=IMPERSONATE,
        http_version="v2",
        max_clients=MAX_CONCURRENT,
        timeout=TIMEOUT_TOTAL_SECONDS,
        # curl caches a failed DoH lookup per host, which would make the next
        # candidate (and the system-resolver fallback) fail instantly too.
        curl_options={CurlOpt.DNS_CACHE_TIMEOUT: 0},
    )


BINARY_CONTENT_PREFIXES = (
    "image/",
    "video/",
    "audio/",
    "application/zip",
    "application/pdf",
    "application/octet-stream",
    "application/vnd.",
)
MAX_BODY_BYTES = 256 * 1024  # 256 KB safety limit


def format_duration(duration: float, cutoff: float = TIME_PRECISION_CUTOFF_SECONDS) -> str:
    if duration < 0:
        return ""
    if duration < cutoff:
        return f"{duration:.3f}s"
    s = int(duration)
    m, s = divmod(s, 60)
    return f"{m}m{s}s" if m else f"{s}s"


def _read_response_html(resp: Response) -> tuple[str | None, str]:
    content_type = resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if any(content_type.startswith(b) for b in BINARY_CONTENT_PREFIXES):
        return None, content_type
    encoding = getattr(resp, "encoding", None) or "utf-8"
    return resp.content[:MAX_BODY_BYTES].decode(encoding, errors="replace"), content_type


@dataclass(frozen=True, slots=True)
class UrlCheck:
    """Enriched result handed to per-source result factories."""

    status: Status
    duration: float
    info: str
    subcategory: str
    http_code: int | None = None
    final_url: str | None = None
    attempts: int = 1


@dataclass(frozen=True, slots=True)
class _ResponseSnapshot:
    status_code: int
    final_url: str
    content_type: str
    headers: dict[str, str]
    html: str | None


async def _fetch_snapshot(session: AsyncSession, url: str, *, doh_url: str | None = None) -> _ResponseSnapshot:
    resp = await session.get(url, doh_url=doh_url, allow_redirects=True)
    html, content_type = _read_response_html(resp)
    return _ResponseSnapshot(
        status_code=resp.status_code,
        final_url=str(resp.url),
        content_type=content_type,
        headers={k.lower(): v for k, v in resp.headers.items()},
        html=html,
    )


class CheckResultProtocol(Protocol):
    @property
    def status(self) -> Status: ...

    @property
    def subcategory(self) -> str: ...

    @property
    def sort_key(self) -> tuple[Any, ...]: ...


class Recordable(Protocol):
    """Anything carrying a check outcome, so `record` can serialize it.

    Satisfied structurally by `UrlCheck` and by each script's `CheckResult`.
    """

    @property
    def status(self) -> Status: ...

    @property
    def duration(self) -> float: ...

    @property
    def info(self) -> str: ...

    @property
    def subcategory(self) -> str: ...

    @property
    def http_code(self) -> int | None: ...

    @property
    def final_url(self) -> str | None: ...

    @property
    def attempts(self) -> int: ...


R = TypeVar("R", bound=CheckResultProtocol)
T = TypeVar("T")


def record(
    item: Recordable, *, subject: Mapping[str, Any] | None = None, extra: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Serialize a check into the shared JSON record shape.

    `subject` keys land right after `status`; `extra` keys just before
    `info`/`subcategory`. This preserves each endpoint's existing field order,
    so the two check scripts only declare their own subject fields.

    Returns:
        A JSON-serializable result record.
    """
    out: dict[str, Any] = {"status": item.status.value}
    if subject:
        out.update(subject)
    out["duration"] = round(item.duration, 3) if item.duration >= 0 else None
    out["time"] = format_duration(item.duration, TIME_PRECISION_CUTOFF_SECONDS)
    out["http_code"] = item.http_code
    out["final_url"] = item.final_url
    out["attempts"] = item.attempts
    if extra:
        out.update(extra)
    out["info"] = item.info
    out["subcategory"] = item.subcategory
    return out


def is_retryable_status(code: int) -> bool:
    """Report whether an HTTP status warrants a retry.

    Returns:
        True for 429 and 5xx, False otherwise.
    """
    return code == 429 or 500 <= code < 600


def _retry_after_seconds(headers: Mapping[str, str], cap: float = RETRY_AFTER_CAP_SECONDS) -> float | None:
    raw = headers.get("retry-after")
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return min(value, cap)


def _host_semaphore(host: str) -> asyncio.Semaphore:
    sem = _host_semaphores.get(host)
    if sem is None:
        sem = asyncio.Semaphore(PER_HOST_LIMIT)
        _host_semaphores[host] = sem
    return sem


async def check_url_generic(
    session: AsyncSession,
    url: str,
    make_result: Callable[[UrlCheck], R],
    *,
    attempts: int = RETRY_ATTEMPTS,
) -> R:
    start = time.perf_counter()
    classification: Classification | None = None
    http_code: int | None = None
    final_url: str | None = None
    attempt = 0
    host = urlsplit(url).hostname or url

    while attempt < attempts:
        attempt += 1
        snapshot: _ResponseSnapshot | None = None
        exc: Exception | None = None

        # Re-sample per attempt so a retry explores fresh nameservers (weights
        # have moved after earlier failures). `None` is the system-resolver last
        # resort, used only when every DoH candidate failed to resolve.
        candidates = [*_router.candidates_for(host)[:DNS_MAX_ATTEMPTS], None]

        # Rotate DoH nameservers within one attempt: a bad resolver is a
        # nameserver problem, not a reason to consume a retry.
        for doh_url in candidates:
            try:
                async with _host_semaphore(host):
                    snapshot = await _fetch_snapshot(session, url, doh_url=doh_url)
            except Exception as e:
                exc = e
                if doh_url is not None and getattr(e, "code", None) == DNS_CURL_CODE:
                    _router.penalize(doh_url)
                    continue
                break
            if doh_url is not None:
                _router.reward(doh_url)
            break

        if snapshot is not None:
            classification = classify_response(
                status_code=snapshot.status_code,
                final_url=snapshot.final_url,
                content_type=snapshot.content_type,
                headers=snapshot.headers,
                html=snapshot.html,
                original_url=url,
            )
            http_code = snapshot.status_code
            final_url = snapshot.final_url
            if is_retryable_status(snapshot.status_code) and attempt < attempts:
                delay = max(
                    _retry_after_seconds(snapshot.headers) or 0.0,
                    RETRY_BACKOFF_SECONDS * 2 ** (attempt - 1),
                ) + random.uniform(0, 0.25)
                log.debug("Retrying %s after HTTP %d (attempt %d/%d)", url, snapshot.status_code, attempt, attempts)
                await asyncio.sleep(delay)
                continue
            break

        if exc is None:  # candidates was empty; never expected
            exc = RuntimeError(f"no response for {url}")
        if attempt >= attempts or not is_retryable(exc):
            classification = classify_exception(exc)
            break
        log.debug("Retrying %s after transient error (attempt %d/%d): %s", url, attempt, attempts, exc)
        await asyncio.sleep(RETRY_BACKOFF_SECONDS * 2 ** (attempt - 1) + random.uniform(0, 0.25))

    if classification is None:  # attempts <= 0 guard; never expected with defaults
        classification = Classification(Status.ERROR, "Unknown")

    return make_result(
        UrlCheck(
            status=classification.status,
            duration=time.perf_counter() - start,
            info=classification.info,
            subcategory=classification.subcategory,
            http_code=http_code,
            final_url=final_url,
            attempts=attempt,
        )
    )


async def check_all_generic(
    session: AsyncSession,
    items: list[T],
    check_fn: Callable[[AsyncSession, T], Awaitable[R]],
    log_fn: Callable[[R, T], None],
) -> list[R]:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def f(item: T) -> R:
        async with semaphore:
            res = await check_fn(session, item)
            log_fn(res, item)
            return res

    return await asyncio.gather(*[f(item) for item in items])
