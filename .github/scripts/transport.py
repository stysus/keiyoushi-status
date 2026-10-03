"""HTTP transport: DoH DNS, fetching, retries, and concurrency.

Owns the I/O side of a source check: a DNS-over-HTTPS resolver, the aiohttp
connector and session plumbing, the fetch-and-retry loop, and the `UrlCheck`
result handed to each check script's result factory. Classification itself
lives in `classify.py`.

Run: imported by check_extensions.py / check_issues.py.
"""

from __future__ import annotations

import asyncio
import logging
import random
import socket
import ssl
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any, Protocol, TypeVar

import aiohttp
import dns.asyncbackend
import dns.asyncquery
import dns.asyncresolver
import dns.exception
import dns.message
import dns.nameserver
import dns.rdatatype
import httpx
import ua_generator
from aia import AIASession
from aiohttp.abc import AbstractResolver, ResolveResult
from classify import (
    Classification,
    Status,
    classify_exception,
    classify_response,
    is_retryable,
)

log = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)  # silence per-request DoH logs

TIMEOUT_TOTAL_SECONDS = 45
TIMEOUT_CONNECT_SECONDS = 15
TIMEOUT_SOCK_READ_SECONDS = 30
MAX_CONCURRENT = 80
TIME_PRECISION_CUTOFF_SECONDS = 10
RETRY_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 0.5

DNS_NAMESERVERS_RU = [
    "https://common.dot.dns.yandex.net/dns-query",  # ru
]

DNS_NAMESERVERS_ZH = [
    "https://dns.alidns.com/dns-query",  # zh
    "https://doh.pub/dns-query",  # zh
    "https://doh.onedns.net/dns-query",  # zh
    "https://doh.360.cn/dns-query",  # zh
]

DNS_NAMESERVERS_JP = [
    "https://public.dns.iij.jp/dns-query",  # jp
    "https://ibuki.cgnat.net/dns-query",  # jp
]

DNS_NAMESERVERS_GLOBAL = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/dns-query",
    "https://dns.quad9.net/dns-query",
    "https://freedns.controld.com/p0",  # Control D uncensored Anycast
    "https://doh.dns.sb/dns-query",
    "https://doh.mullvad.net/dns-query",
    "https://doh.opendns.com/dns-query",
    "https://dns.nextdns.io/dns-query",
    "https://dns.aa.net.uk/dns-query",
    "https://adfree.usableprivacy.net/",
    "https://dns.brahma.world/dns-query",
    "https://dns.digitale-gesellschaft.ch/dns-query",
    "https://dns.dnshome.de/dns-query",
    "https://dns.dnsoverhttps.com/dnfs-query",
    "https://dns.flatuslifir.is/dns-query",
    "https://dns.hostux.net/dns-query",
    "https://dns.njal.la/dns-query",
    "https://dns.switch.ch/dns-query",
    "https://dnsforge.de/dns-query",
    "https://doh-de.blahdns.com/dns-query",
    "https://doh.42l.fr/dns-query",
    "https://doh.applied-privacy.net/query",
    "https://doh.ffmuc.net/dns-query",
    "https://doh.li/dns-query",
    "https://doh.libredns.gr/dns-query",
    "https://doh.tiarap.org/dns-query",
    "https://doh.xfinity.com/dns-query",
    "https://ordns.he.net/dns-query",
    "https://private.canadianshield.cira.ca/dns-query",
    "https://wikimedia-dns.org/dns-query",
]

DNS_TLDS_RU = (".ru", ".su", ".by", ".kz")
DNS_TLDS_ZH = (".cn", ".top", ".wang", ".xin", ".site")
DNS_TLDS_JP = (".jp",)

DNS_RDTYPES_BY_FAMILY = {
    socket.AF_INET: (dns.rdatatype.A,),
    socket.AF_INET6: (dns.rdatatype.AAAA,),
}

DNS_MAX_ATTEMPTS = 3
DNS_WEIGHT_INITIAL = 1.0
DNS_WEIGHT_MIN = 0.1
DNS_WEIGHT_MAX = 3.0
DNS_WEIGHT_REWARD = 0.1
DNS_WEIGHT_PENALTY = 0.3


@dataclass
class _NameserverScore:
    weight: float = DNS_WEIGHT_INITIAL

    def reward(self) -> None:
        self.weight = min(DNS_WEIGHT_MAX, self.weight + DNS_WEIGHT_REWARD)

    def penalize(self) -> None:
        # floor keeps a struggling nameserver eligible so it can recover
        self.weight = max(DNS_WEIGHT_MIN, self.weight - DNS_WEIGHT_PENALTY)


def _weighted_sample_without_replacement(
    pool: list[tuple[str, float]],
    k: int,
    rng: random.Random,
) -> list[str]:
    pool = pool.copy()
    picked: list[str] = []
    for _ in range(min(k, len(pool))):
        total = sum(weight for _, weight in pool)
        target = rng.uniform(0, total)
        cumulative = 0.0
        for i, (nameserver, weight) in enumerate(pool):
            cumulative += weight
            if cumulative >= target:
                picked.append(nameserver)
                pool.pop(i)
                break
    return picked


class _PersistentDoHNameserver(dns.nameserver.DoHNameserver):
    """DoHNameserver that reuses one httpx.AsyncClient instead of opening a new TLS connection per query."""

    def __init__(self, url: str, client: httpx.AsyncClient) -> None:
        super().__init__(url)
        self._client = client

    async def async_query(
        self,
        request: dns.message.QueryMessage,
        timeout: float,  # signature must match Nameserver.async_query
        source: str | None,
        source_port: int,
        max_size: bool,  # unused, required by Nameserver.async_query signature
        backend: dns.asyncbackend.Backend,  # unused, required by Nameserver.async_query signature
        one_rr_per_rrset: bool = False,
        ignore_trailing: bool = False,
    ) -> dns.message.Message:
        return await dns.asyncquery.https(
            request,
            self.url,
            timeout=timeout,
            source=source,
            source_port=source_port,
            one_rr_per_rrset=one_rr_per_rrset,
            ignore_trailing=ignore_trailing,
            verify=self.verify,
            post=(not self.want_get),
            http_version=self.http_version,
            client=self._client,
        )


class DNSPythonResolver(AbstractResolver):
    def __init__(
        self,
        nameservers: list[str] | None = None,
        fallback_nameservers: list[str] | None = None,
        *,
        ru_nameservers: list[str] | None = None,
        zh_nameservers: list[str] | None = None,
        jp_nameservers: list[str] | None = None,
    ) -> None:
        # own Random instance: avoids interleaving with generate_headers' global random.seed/setstate
        self._rng = random.Random()
        self._global_nameservers = list(nameservers) if nameservers is not None else list(DNS_NAMESERVERS_GLOBAL)
        self._ru_nameservers = list(ru_nameservers) if ru_nameservers is not None else list(DNS_NAMESERVERS_RU)
        self._zh_nameservers = (
            list(zh_nameservers)
            if zh_nameservers is not None
            else (list(fallback_nameservers) if fallback_nameservers is not None else list(DNS_NAMESERVERS_ZH))
        )
        self._jp_nameservers = list(jp_nameservers) if jp_nameservers is not None else list(DNS_NAMESERVERS_JP)

        all_unique = list(
            dict.fromkeys(self._global_nameservers + self._ru_nameservers + self._zh_nameservers + self._jp_nameservers)
        )
        self._scores = {ns: _NameserverScore() for ns in all_unique}
        self._clients: dict[str, httpx.AsyncClient] = {}
        self._resolvers: dict[str, dns.asyncresolver.Resolver] = {}
        for ns in all_unique:
            client = httpx.AsyncClient(http2=True)
            self._clients[ns] = client
            resolver = dns.asyncresolver.Resolver(configure=False)
            resolver.nameservers = [_PersistentDoHNameserver(ns, client)]
            self._resolvers[ns] = resolver

    def _pick_nameservers(self, servers: list[str], k: int) -> list[str]:
        pool = [(ns, self._scores[ns].weight) for ns in servers if ns in self._scores]
        return _weighted_sample_without_replacement(pool, min(k, len(pool)), self._rng)

    def _get_nameservers_for_host(self, host: str) -> list[str]:
        host_lower = host.lower().rstrip(".")
        if any(host_lower == tld.lstrip(".") or host_lower.endswith(tld) for tld in DNS_TLDS_RU):
            primary = self._ru_nameservers
            secondary = self._global_nameservers
            tertiary = self._zh_nameservers + self._jp_nameservers
        elif any(host_lower == tld.lstrip(".") or host_lower.endswith(tld) for tld in DNS_TLDS_ZH):
            primary = self._zh_nameservers
            secondary = self._global_nameservers
            tertiary = self._ru_nameservers + self._jp_nameservers
        elif any(host_lower == tld.lstrip(".") or host_lower.endswith(tld) for tld in DNS_TLDS_JP):
            primary = self._jp_nameservers
            secondary = self._global_nameservers
            tertiary = self._ru_nameservers + self._zh_nameservers
        else:
            primary = self._global_nameservers
            secondary = self._zh_nameservers + self._jp_nameservers + self._ru_nameservers
            tertiary = []

        chosen: list[str] = []
        k_primary = len(primary) if primary is not self._global_nameservers else DNS_MAX_ATTEMPTS
        chosen.extend(self._pick_nameservers(primary, k_primary))

        k_secondary = DNS_MAX_ATTEMPTS if secondary is self._global_nameservers else len(secondary)
        chosen.extend(self._pick_nameservers(secondary, k_secondary))

        if tertiary:
            chosen.extend(self._pick_nameservers(tertiary, len(tertiary)))

        return list(dict.fromkeys(chosen))

    async def resolve(
        self,
        host: str,
        port: int = 0,
        family: socket.AddressFamily = socket.AF_INET,
    ) -> list[ResolveResult]:
        results: list[ResolveResult] = []
        for rdtype in DNS_RDTYPES_BY_FAMILY.get(family, (dns.rdatatype.A, dns.rdatatype.AAAA)):
            nameservers = self._get_nameservers_for_host(host)
            for nameserver in nameservers:
                score = self._scores.get(nameserver)
                try:
                    answer = await self._resolvers[nameserver].resolve(host, rdtype)
                except dns.exception.DNSException as e:
                    log.debug("DNS %s %s failed via %s: %s", dns.rdatatype.to_text(rdtype), host, nameserver, e)
                    if score is not None:
                        score.penalize()
                    continue
                if score is not None:
                    score.reward()
                log.info(
                    "DNS %s %s -> %s via %s",
                    dns.rdatatype.to_text(rdtype),
                    host,
                    [rdata.address for rdata in answer],
                    nameserver,
                )
                results.extend(
                    ResolveResult(
                        hostname=host,
                        host=rdata.address,
                        port=port,
                        family=socket.AF_INET6 if rdtype == dns.rdatatype.AAAA else socket.AF_INET,
                        proto=0,
                        flags=socket.AI_NUMERICHOST | socket.AI_NUMERICSERV,
                    )
                    for rdata in answer
                )
                break
        if not results:
            raise OSError(None, f"DNS lookup failed for {host}")
        return results

    async def close(self) -> None:
        for client in self._clients.values():
            await client.aclose()


class _DoHTCPConnector(aiohttp.TCPConnector):
    """TCPConnector that properly closes custom DoH resolver clients on close()."""

    async def close(self, *, abort_ssl: bool = False) -> None:
        if self._resolver is not None:
            await self._resolver.close()
        await super().close(abort_ssl=abort_ssl)


def create_connector() -> aiohttp.TCPConnector:
    resolver = DNSPythonResolver(
        DNS_NAMESERVERS_GLOBAL,
        ru_nameservers=DNS_NAMESERVERS_RU,
        zh_nameservers=DNS_NAMESERVERS_ZH,
        jp_nameservers=DNS_NAMESERVERS_JP,
    )
    return _DoHTCPConnector(resolver=resolver)


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


def generate_headers(seed: str) -> dict[str, str]:
    rng_state = random.getstate()
    random.seed(seed)
    ua = ua_generator.generate(device="desktop", browser=["chrome", "edge"])
    random.setstate(rng_state)

    log.info("Using User-Agent: %s", ua)
    headers: dict[str, str | None] = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.6",
        "Priority": "u=0, i",
        "Referer": "https://search.brave.com/",
        "Sec-Ch-Ua": None,
        "Sec-Ch-Ua-Mobile": None,
        "Sec-Ch-Ua-Platform": None,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "Sec-Gpc": "1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": None,
    }
    headers_ua = {k.title(): v for k, v in ua.headers.get().items()}
    headers.update(headers_ua)
    return {k: v for k, v in headers.items() if v is not None}


def format_duration(duration: float, cutoff: float = TIME_PRECISION_CUTOFF_SECONDS) -> str:
    if duration < 0:
        return ""
    if duration < cutoff:
        return f"{duration:.3f}s"
    s = int(duration)
    m, s = divmod(s, 60)
    return f"{m}m{s}s" if m else f"{s}s"


_aia_session = AIASession()


async def _build_aia_ssl_context(url: str) -> ssl.SSLContext:
    # ssl_context_from_url is blocking (sync sockets), so run it off the event loop
    return await asyncio.get_event_loop().run_in_executor(
        None,
        partial(_aia_session.ssl_context_from_url, url),
    )


async def _read_response_html(resp: aiohttp.ClientResponse) -> str | None:
    content_type = resp.content_type.lower()
    if any(content_type.startswith(b) for b in BINARY_CONTENT_PREFIXES):
        return None
    raw_bytes = await resp.content.read(MAX_BODY_BYTES)
    encoding = resp.charset or "utf-8"
    return raw_bytes.decode(encoding, errors="replace")


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


async def _fetch_snapshot(session: aiohttp.ClientSession, url: str) -> _ResponseSnapshot:
    async def _get(ssl_context: ssl.SSLContext | None = None) -> _ResponseSnapshot:
        async with session.get(url, ssl=ssl_context) as resp:
            html = await _read_response_html(resp)
            return _ResponseSnapshot(
                status_code=resp.status,
                final_url=str(resp.url),
                content_type=resp.content_type,
                headers={k.lower(): v for k, v in resp.headers.items()},
                html=html,
            )

    try:
        return await _get()
    except aiohttp.ClientConnectorCertificateError:
        # some servers omit intermediate certs; complete the chain like a browser would
        return await _get(await _build_aia_ssl_context(url))


class CheckResultProtocol(Protocol):
    @property
    def status(self) -> Status: ...

    @property
    def subcategory(self) -> str: ...

    @property
    def sort_key(self) -> tuple[Any, ...]: ...


R = TypeVar("R", bound=CheckResultProtocol)
T = TypeVar("T")


async def check_url_generic(
    session: aiohttp.ClientSession,
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

    while attempt < attempts:
        attempt += 1
        try:
            snapshot = await _fetch_snapshot(session, url)
        except Exception as e:
            if attempt >= attempts or not is_retryable(e):
                classification = classify_exception(e)
                break
            log.debug("Retrying %s after transient error (attempt %d/%d): %s", url, attempt, attempts, e)
            await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
            continue

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
        break

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
    session: aiohttp.ClientSession,
    items: list[T],
    check_fn: Callable[[aiohttp.ClientSession, T], Awaitable[R]],
    log_fn: Callable[[R, T], None],
) -> list[R]:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def f(item: T) -> R:
        async with semaphore:
            res = await check_fn(session, item)
            log_fn(res, item)
            return res

    return await asyncio.gather(*[f(item) for item in items])
