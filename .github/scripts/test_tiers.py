#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Self-check for the shared tier taxonomy. Fixtures mirror the cases the
# history snapshot and the regression guard depend on, so a change to the
# taxonomy that would silently move the guard's baseline fails here first.
#
# Run: uv run .github/scripts/test_tiers.py

from __future__ import annotations

from tiers import Tier, is_operational, tier_of


def main() -> None:
    cases = [
        (("ok", ""), Tier.OK, True),
        (("iuam", ""), Tier.CHALLENGE, True),
        (("waf", ""), Tier.CHALLENGE, True),
        (("redirect", "Same Authority"), Tier.CHALLENGE, True),
        (("redirect", "same authority (js)"), Tier.CHALLENGE, True),
        (("redirect", "Meta Refresh"), Tier.OFFLINE, False),
        (("redirect", ""), Tier.OFFLINE, False),
        (("rate_limited", ""), Tier.DEGRADED, False),
        (("warning", ""), Tier.DEGRADED, False),
        (("error", ""), Tier.OFFLINE, False),
        (("blocked", ""), Tier.OFFLINE, False),
        (("not_found", ""), Tier.OFFLINE, False),
        (("dns_error", ""), Tier.OFFLINE, False),
        (("parked", ""), Tier.OFFLINE, False),
        (("placeholder", ""), Tier.OFFLINE, False),
        (("", ""), Tier.OFFLINE, False),
    ]
    for (status, subcategory), want_tier, want_op in cases:
        got = tier_of(status, subcategory)
        assert got is want_tier, f"tier_of({status!r}, {subcategory!r}) = {got}, want {want_tier}"
        assert is_operational(got) is want_op, f"is_operational({got}) = {not want_op}"

    # Aggregate contract the history snapshot and guard both rely on.
    results = [
        {"status": "ok"},
        {"status": "iuam"},
        {"status": "redirect", "subcategory": "Same Authority"},
        {"status": "redirect", "subcategory": "Meta Refresh"},
        {"status": "warning"},
        {"status": "error"},
    ]
    counts = {"total": 0, "ok": 0, "challenge": 0, "degraded": 0, "offline": 0}
    for item in results:
        counts["total"] += 1
        counts[tier_of(item.get("status", ""), item.get("subcategory") or "").value] += 1
    assert counts == {"total": 6, "ok": 1, "challenge": 2, "degraded": 1, "offline": 2}, counts
    assert counts["ok"] + counts["challenge"] == 3

    print("tiers selftest OK")


if __name__ == "__main__":
    main()
