#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Self-check for the pure per-TLD DoH router. No network: it only proves the
# ordering, de-duplication, determinism, and score bounds the transport relies on.
#
# Run via: .github/scripts/test_dns.py (no network, stdlib only)

from __future__ import annotations

import random

from dns import DNS_NAMESERVERS_GLOBAL, DNS_NAMESERVERS_JP, DNS_NAMESERVERS_RU, DNS_NAMESERVERS_ZH, DoHRouter


def main() -> None:
    router = DoHRouter(rng=random.Random(0))

    ru = router.candidates_for("example.ru")
    assert ru[0] in DNS_NAMESERVERS_RU, ru
    assert len(ru) == len(set(ru)), ru

    zh = router.candidates_for("example.cn")
    assert zh[0] in DNS_NAMESERVERS_ZH, zh

    jp = router.candidates_for("example.jp")
    assert jp[0] in DNS_NAMESERVERS_JP, jp

    gl = router.candidates_for("example.com")
    assert gl[0] in DNS_NAMESERVERS_GLOBAL, gl
    assert set(DNS_NAMESERVERS_GLOBAL) <= set(gl), gl  # global pool fully available

    # Review Focus 1: unknown/empty host still yields a usable global pool
    empty = router.candidates_for("")
    assert empty, empty
    assert empty[0] in DNS_NAMESERVERS_GLOBAL, empty

    # weighted selection is deterministic for a fixed rng and never repeats a nameserver
    left = DoHRouter(rng=random.Random(1)).candidates_for("a.ru")
    right = DoHRouter(rng=random.Random(1)).candidates_for("a.ru")
    assert left == right, (left, right)

    # scores stay within [0.1, 3.0]
    url = DNS_NAMESERVERS_GLOBAL[0]
    for _ in range(50):
        router.reward(url)
    assert router._scores[url].weight <= 3.0  # noqa: SLF001
    for _ in range(50):
        router.penalize(url)
    assert router._scores[url].weight >= 0.1  # noqa: SLF001

    print("dns selftest OK")


if __name__ == "__main__":
    main()
