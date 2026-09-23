from __future__ import annotations

import asyncio
import logging
import random
import re
import socket
import ssl
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from http import HTTPStatus
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
from bs4 import BeautifulSoup
from publicsuffixlist import PublicSuffixList  # type: ignore[import-untyped]
from yarl import URL

log = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)  # silence per-request DoH logs
psl = PublicSuffixList()

TIMEOUT_TOTAL_SECONDS = 45
TIMEOUT_CONNECT_SECONDS = 15
TIMEOUT_SOCK_READ_SECONDS = 30
TIMEOUT_SECONDS = TIMEOUT_TOTAL_SECONDS
MAX_CONCURRENT = 80
PATTERN_WWSUB = re.compile(r"^ww\d+\.")
MIN_NODES_WARN = 20
TIME_PRECISION_CUTOFF_SECONDS = 10

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

# Backward-compatibility alias
DNS_NAMESERVERS = DNS_NAMESERVERS_GLOBAL

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
        timeout: float,  # noqa: ASYNC109 - signature must match Nameserver.async_query
        source: str | None,
        source_port: int,
        max_size: bool,  # noqa: ARG002 - unused, required by Nameserver.async_query signature
        backend: dns.asyncbackend.Backend,  # noqa: ARG002 - unused, required by Nameserver.async_query signature
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
            dict.fromkeys(
                self._global_nameservers
                + self._ru_nameservers
                + self._zh_nameservers
                + self._jp_nameservers
            )
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


def create_connector() -> aiohttp.TCPConnector:
    resolver = DNSPythonResolver(
        DNS_NAMESERVERS_GLOBAL,
        ru_nameservers=DNS_NAMESERVERS_RU,
        zh_nameservers=DNS_NAMESERVERS_ZH,
        jp_nameservers=DNS_NAMESERVERS_JP,
    )
    return aiohttp.TCPConnector(resolver=resolver)


class Status(StrEnum):
    OK = "✅"
    ERROR = "❌"
    WARNING = "⚠️"
    CF_BLOCK = "🛑"
    CF_IUAM = "🚧"
    WAF = "🛡️"
    RATE_LIMITED = "⏳"
    DNS_ERROR = "🔌"
    REDIRECT = "🔀"
    PARKED = "🅿️"
    NOT_FOUND = "🔍"
    PLACEHOLDER = "🪧"


REPORT_SECTIONS: list[tuple[str, Status]] = [
    ("OK", Status.OK),
    ("Redirects", Status.REDIRECT),
    ("Cloudflare IUAM", Status.CF_IUAM),
    ("Cloudflare Blocked", Status.CF_BLOCK),
    ("WAF / DDoS-Guard", Status.WAF),
    ("Rate Limited", Status.RATE_LIMITED),
    ("DNS Errors", Status.DNS_ERROR),
    ("Placeholder", Status.PLACEHOLDER),
    ("Parked Domains", Status.PARKED),
    ("Not Found", Status.NOT_FOUND),
    ("Warnings", Status.WARNING),
    ("Errors", Status.ERROR),
]

MAX_BODY_BYTES = 256 * 1024  # 256 KB safety limit
META_REFRESH_RE = re.compile(
    r"""<meta[^>]+http-equiv=['"]?refresh['"]?[^>]+content=['"]?\d+\s*;\s*url=['"]?([^'">\s]+)""",
    re.IGNORECASE,
)
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

    if cleaned_lower in (str(status_code), f"http {status_code}"):
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


class CheckResultProtocol(Protocol):
    @property
    def status(self) -> Status: ...

    @property
    def subcategory(self) -> str: ...

    @property
    def sort_key(self) -> tuple[Any, ...]: ...


R = TypeVar("R", bound=CheckResultProtocol)
T = TypeVar("T")


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


async def check_url_generic(
    session: aiohttp.ClientSession,
    url: str,
    make_result: Callable[[Status, float, str, str], R],
) -> R:
    infos: list[str] = []
    parked_signals: list[str] = []
    start = time.perf_counter()

    def result(status: Status, subcategory: str = "") -> R:
        duration = time.perf_counter() - start
        parts = infos.copy()
        if parked_signals:
            parts.append(f"Method: {', '.join(parked_signals)}")
        return make_result(status, duration, ". ".join(parts), subcategory)

    try:
        try:
            async with session.get(url) as resp:
                content_type = resp.content_type.lower()
                # Safety check: bypass parsing for non-HTML binaries
                if any(content_type.startswith(b) for b in ("image/", "video/", "audio/", "application/zip", "application/pdf", "application/octet-stream", "application/vnd.")):
                    infos.append(f"Non-HTML ({content_type})")
                    if resp.status == HTTPStatus.OK:
                        return result(Status.OK, subcategory=f"Binary ({content_type})")
                    return result(Status.WARNING, subcategory=f"Binary {resp.status}")

                raw_bytes = await resp.content.read(MAX_BODY_BYTES)
                encoding = resp.charset or "utf-8"
                html = raw_bytes.decode(encoding, errors="replace")
        except aiohttp.ClientConnectorCertificateError:
            # some servers omit intermediate certs; complete the chain like a browser would
            ssl_context = await _build_aia_ssl_context(url)
            async with session.get(url, ssl=ssl_context) as resp:
                content_type = resp.content_type.lower()
                if any(content_type.startswith(b) for b in ("image/", "video/", "audio/", "application/zip", "application/pdf", "application/octet-stream", "application/vnd.")):
                    infos.append(f"Non-HTML ({content_type})")
                    if resp.status == HTTPStatus.OK:
                        return result(Status.OK, subcategory=f"Binary ({content_type})")
                    return result(Status.WARNING, subcategory=f"Binary {resp.status}")

                raw_bytes = await resp.content.read(MAX_BODY_BYTES)
                encoding = resp.charset or "utf-8"
                html = raw_bytes.decode(encoding, errors="replace")

        soup = BeautifulSoup(html, "lxml")

        node_count = len(soup.select("*"))

        redirected = not str(resp.url).startswith(url)
        if redirected:
            infos.append(f"Redirected: {resp.url}")
            parked_signals.extend(check_parked_redirect(resp.url))

        title = soup.title.string.strip() if soup.title and soup.title.string else ""
        title_lower = title.lower()
        html_lower = html.lower()
        server_header = resp.headers.get("server", "").lower()

        # HTML Meta Refresh & JS Redirect Detection
        meta_refresh_match = META_REFRESH_RE.search(html[:4096])
        if meta_refresh_match:
            target = meta_refresh_match.group(1).strip()
            if not target.startswith(("http://", "https://")):
                target = str(URL(url).join(URL(target)))
            if target != url:
                infos.append(f"Meta Refresh -> {target}")
                subcat = "Same Authority (Meta)" if is_same_authority(url, target) else "Meta Refresh"
                return result(Status.REDIRECT, subcat)

        js_redirect_match = WINDOW_LOCATION_RE.search(html[:4096])
        if js_redirect_match:
            target = js_redirect_match.group(1).strip()
            if target != url:
                infos.append(f"JS Redirect -> {target}")
                subcat = "Same Authority (JS)" if is_same_authority(url, target) else "JS Redirect"
                return result(Status.REDIRECT, subcat)

        # 1. Cloudflare Challenges & Blocks
        if not redirected:
            if (
                title in ("Just a moment...", "Checking your browser...", "Verify you are human")
                or "challenges.cloudflare.com" in html_lower
                or "cf-turnstile" in html_lower
                or "turnstile-wrapper" in html_lower
                or "cf-browser-verification" in html_lower
                or ("ray id:" in html_lower and ("verifying you are human" in html_lower or "enable javascript and cookies" in html_lower))
            ):
                infos = []
                return result(Status.CF_IUAM)

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
                return result(Status.CF_BLOCK)

        # 2. Third-Party WAF / DDoS-Guard / Sucuri / Imperva
        if (
            "ddos-guard" in server_header
            or "ddos-guard" in title_lower
            or "ddos protection by ddos-guard" in html_lower
            or "checking your browser before accessing" in html_lower
            or "check.ddos-guard.net" in html_lower
        ):
            return result(Status.WAF, subcategory="DDoS-Guard")

        if (
            "x-sucuri-id" in resp.headers
            or "x-sucuri-cache" in resp.headers
            or "sucuri website firewall" in html_lower
            or "access denied - sucuri" in title_lower
        ):
            return result(Status.WAF, subcategory="Sucuri WAF")

        if (
            "imperva" in resp.headers.get("x-cdn", "").lower()
            or "_incapsula_resource" in html_lower
            or "incapsula incident id" in html_lower
            or "request unsuccessful. incapsula" in html_lower
        ):
            return result(Status.WAF, subcategory="Imperva WAF")

        if "security check" in title_lower or "challenge validation" in title_lower:
            return result(Status.WAF, subcategory="WAF Challenge")

        # 3. Rate Limiting (HTTP 429 / Error 1015)
        if resp.status == HTTPStatus.TOO_MANY_REQUESTS or "rate limit" in title_lower or "error 1015" in title_lower:
            return result(Status.RATE_LIMITED, subcategory="HTTP 429" if resp.status == 429 else "Rate Limited")

        # 4. HTTP 404 (Not Found)
        if resp.status == HTTPStatus.NOT_FOUND:
            return result(Status.NOT_FOUND, subcategory="HTTP 404")

        # 5. Placeholders & Maintenance
        if check_placeholder_content(title, html):
            return result(Status.PLACEHOLDER, subcategory="Default Server Page")

        if any(m in title_lower for m in MAINTENANCE_TITLES) or ("under maintenance" in html_lower and node_count < 30):
            infos.append("Site under maintenance")
            return result(Status.PLACEHOLDER, subcategory="Maintenance")

        # 6. Parked / For Sale / Expired Domains
        parked_signals.extend(check_parked_content(title, html))
        if parked_signals:
            return result(Status.PARKED, subcategory="Domain For Sale / Parked")

        # 7. HTTP Redirects
        if redirected:
            subcategory = "Same Authority" if is_same_authority(url, str(resp.url)) else ""
            return result(Status.REDIRECT, subcategory)

        # 8. Operational (HTTP 200 OK) with False-Positive Checks
        if resp.status == HTTPStatus.OK:
            # Check A: Blank page (few nodes and minimal text)
            body_text = soup.text.strip()
            if node_count < 6 and len(body_text) < 20:
                infos.append(f"Empty page ({node_count} nodes)")
                return result(Status.WARNING, subcategory="Blank Page")

            # Check B: Database connection error disguised as 200
            if any(db_err in html_lower for db_err in DB_ERROR_PATTERNS):
                infos.append("Database connection failure")
                return result(Status.WARNING, subcategory="Database Error")

            if node_count < MIN_NODES_WARN:
                infos.append(f"Few nodes ({node_count})")

            return result(Status.OK, subcategory="With Notes" if infos else "")

        # 9. Warnings with enriched subcategories
        if resp.status in (520, 521, 522, 523, 524, 525, 526):
            cf_subcat_map = {
                520: "Cloudflare 520 (Unknown Error)",
                521: "Cloudflare 521 (Server Down)",
                522: "Cloudflare 522 (Connection Timed Out)",
                523: "Cloudflare 523 (Origin Unreachable)",
                524: "Cloudflare 524 (Timeout)",
                525: "Cloudflare 525 (SSL Handshake Failed)",
                526: "Cloudflare 526 (Invalid SSL)",
            }
            subcategory = cf_subcat_map.get(resp.status, f"Cloudflare {resp.status}")
        elif 500 <= resp.status < 600:
            subcategory = f"Server Error ({resp.status})"
        elif resp.status == HTTPStatus.FORBIDDEN:
            subcategory = "Forbidden (403)"
        else:
            subcategory = f"HTTP {resp.status}"

        cleaned_msg = _clean_error_title(title, resp.status, subcategory)
        if cleaned_msg:
            infos.append(cleaned_msg)

        return result(Status.WARNING, subcategory=subcategory)

    except Exception as e:
        if msg := str(e):
            infos.append(msg)
        # Classify DNS, SSL, Timeout, Redirect Loop, and Connection Errors
        if isinstance(e, aiohttp.TooManyRedirects):
            return result(Status.WARNING, subcategory="Redirect Loop")
        if isinstance(e, (aiohttp.ClientConnectorDNSError, socket.gaierror)) or "DNS lookup failed" in str(e):
            return result(Status.DNS_ERROR, subcategory="DNS Failure")
        if isinstance(e, (aiohttp.ClientConnectorSSLError, aiohttp.ClientConnectorCertificateError, ssl.SSLError)):
            return result(Status.ERROR, subcategory="SSL Error")
        if isinstance(e, (asyncio.TimeoutError, TimeoutError)) or "timeout" in str(e).lower():
            return result(Status.ERROR, subcategory="Timeout")
        if isinstance(e, aiohttp.ClientConnectorError):
            return result(Status.ERROR, subcategory="Connection Failed")
        return result(Status.ERROR, subcategory=type(e).__name__)


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
