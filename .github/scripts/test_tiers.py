#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# Self-check for the shared tier taxonomy. Cases come from
# tests/tier_cases.json, which the web self-check (tests/web.test.mjs) reads
# too, so Python's tier_of and the JS getTierCategory mirror cannot drift.
#
# Run: uv run .github/scripts/test_tiers.py

from __future__ import annotations

import json
from pathlib import Path

from tiers import is_operational, tier_of

CASES_PATH = Path(__file__).resolve().parents[2] / "tests" / "tier_cases.json"


def main() -> None:
    for case in json.loads(CASES_PATH.read_text(encoding="utf-8")):
        status, subcategory = case["status"], case["subcategory"]
        got = tier_of(status, subcategory)
        assert got.value == case["tier"], f"tier_of({status!r}, {subcategory!r}) = {got.value}, want {case['tier']}"
        assert is_operational(got) is case["operational"], f"is_operational({got.value}) != {case['operational']}"

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
