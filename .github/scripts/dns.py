"""Pure per-TLD DNS-over-HTTPS routing for the curl_cffi transport.

Owns the DoH nameserver pools, the TLD→pool routing, and the weighted,
reward/penalty scoring used to order candidates. No I/O and stdlib only, so it
is unit-testable without a network and cheap to import.

Run: imported by transport.py; tested by test_dns.py.
"""

from __future__ import annotations

import random

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

DNS_MAX_ATTEMPTS = 3
DNS_WEIGHT_INITIAL = 1.0
DNS_WEIGHT_MIN = 0.1
DNS_WEIGHT_MAX = 3.0
DNS_WEIGHT_REWARD = 0.1
DNS_WEIGHT_PENALTY = 0.3


class NameserverScore:
    """Adaptive weight for one nameserver, bounded so it can always recover."""

    def __init__(self, weight: float = DNS_WEIGHT_INITIAL) -> None:
        self.weight = weight

    def reward(self) -> None:
        self.weight = min(DNS_WEIGHT_MAX, self.weight + DNS_WEIGHT_REWARD)

    def penalize(self) -> None:
        # floor keeps a struggling nameserver eligible so it can recover
        self.weight = max(DNS_WEIGHT_MIN, self.weight - DNS_WEIGHT_PENALTY)


def weighted_sample_without_replacement(
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


class DoHRouter:
    """Ordered DoH candidates per host, with weighted, rewarded selection."""

    def __init__(
        self,
        *,
        nameservers: list[str] | None = None,
        ru_nameservers: list[str] | None = None,
        zh_nameservers: list[str] | None = None,
        jp_nameservers: list[str] | None = None,
        rng: random.Random | None = None,
    ) -> None:
        # own Random instance: avoids interleaving with other global random users
        self._rng = rng if rng is not None else random.Random()
        self._global = list(nameservers) if nameservers is not None else list(DNS_NAMESERVERS_GLOBAL)
        self._ru = list(ru_nameservers) if ru_nameservers is not None else list(DNS_NAMESERVERS_RU)
        self._zh = list(zh_nameservers) if zh_nameservers is not None else list(DNS_NAMESERVERS_ZH)
        self._jp = list(jp_nameservers) if jp_nameservers is not None else list(DNS_NAMESERVERS_JP)

        all_unique = list(dict.fromkeys(self._global + self._ru + self._zh + self._jp))
        self._scores = {ns: NameserverScore() for ns in all_unique}

    def _weighted(self, servers: list[str]) -> list[str]:
        pool = [(ns, self._scores[ns].weight) for ns in servers if ns in self._scores]
        return weighted_sample_without_replacement(pool, len(pool), self._rng)

    def _pools_for(self, host: str) -> tuple[list[str], list[str], list[str]]:
        host_lower = host.lower().rstrip(".")
        if any(host_lower == tld.lstrip(".") or host_lower.endswith(tld) for tld in DNS_TLDS_RU):
            return self._ru, self._global, self._zh + self._jp
        if any(host_lower == tld.lstrip(".") or host_lower.endswith(tld) for tld in DNS_TLDS_ZH):
            return self._zh, self._global, self._ru + self._jp
        if any(host_lower == tld.lstrip(".") or host_lower.endswith(tld) for tld in DNS_TLDS_JP):
            return self._jp, self._global, self._ru + self._zh
        return self._global, self._zh + self._jp + self._ru, []

    def candidates_for(self, host: str) -> list[str]:
        """Ordered, de-duplicated DoH URLs to try for a host, primary first.

        Returns:
            The candidate DoH endpoint URLs, most-preferred first.
        """
        primary, secondary, tertiary = self._pools_for(host)
        chosen: list[str] = []
        chosen.extend(self._weighted(primary))
        chosen.extend(self._weighted(secondary))
        if tertiary:
            chosen.extend(self._weighted(tertiary))
        return list(dict.fromkeys(chosen))

    def reward(self, url: str) -> None:
        score = self._scores.get(url)
        if score is not None:
            score.reward()

    def penalize(self, url: str) -> None:
        score = self._scores.get(url)
        if score is not None:
            score.penalize()
