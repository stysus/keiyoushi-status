#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""Abort a run whose status distribution looks like a classifier regression.

The previous committed `extensions.json` is used as the baseline. A heuristic
bug (e.g. every page classified as WARNING) shows up as one status category
suddenly dominating, which is far more plausible than a simultaneous real
outage across ~1500 unrelated sites.

Run:
    .github/scripts/guard_regression.py            # check
    .github/scripts/guard_regression.py --selftest # pure-logic self-check
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

NEW_PATH = "web/data/extensions.json"
OLD_REF = "HEAD:web/data/extensions.json"
MIN_BASELINE = 200  # need enough history for shares to mean anything
STATUS_DELTA = 0.30  # a status may not grow by more than 30 points...
STATUS_FLOOR = 0.50  # ...and may not pass half of all results
OPERATIONAL_DROP = 0.25  # nor may operational share collapse by 25 points
OPERATIONAL_STATUSES = {"✅", "🚧", "🛡️"}


def status_counts(results: list[dict]) -> Counter[str]:
    return Counter(item.get("status", "") for item in results)


def operational_share(results: list[dict]) -> float:
    if not results:
        return 0.0
    count = 0
    for item in results:
        status = item.get("status", "")
        subcategory = (item.get("subcategory") or "").lower()
        if status in OPERATIONAL_STATUSES or (status == "🔀" and "same authority" in subcategory):
            count += 1
    return count / len(results)


def detect_regressions(old: list[dict], new: list[dict]) -> list[str]:
    """Return human-readable reasons the new run looks regressed (empty if fine)."""
    old_counts = status_counts(old)
    new_counts = status_counts(new)
    findings: list[str] = []

    n_old = sum(old_counts.values())
    n_new = sum(new_counts.values())
    if n_old and n_new:
        for status in sorted(set(old_counts) | set(new_counts)):
            old_share = old_counts[status] / n_old
            new_share = new_counts[status] / n_new
            if new_share - old_share > STATUS_DELTA and new_share > STATUS_FLOOR:
                findings.append(f"status {status or '(blank)'} jumped {old_share:.1%} -> {new_share:.1%} of results")

    drop = operational_share(old) - operational_share(new)
    if drop > OPERATIONAL_DROP:
        findings.append(f"operational share dropped {operational_share(old):.1%} -> {operational_share(new):.1%}")

    return findings


def load_baseline() -> list[dict] | None:
    try:
        raw = subprocess.run(["git", "show", OLD_REF], capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return json.loads(raw).get("results", [])


def selftest() -> None:
    ok = [{"status": "✅"} for _ in range(900)] + [{"status": "⚠️"} for _ in range(100)]
    # mass misclassification: ⚠️ jumps 10% -> 80%
    assert detect_regressions(ok, [{"status": "✅"}] * 200 + [{"status": "⚠️"}] * 800), "mass WARNING not caught"
    # a moderate, real shift stays below the alarm
    assert not detect_regressions(ok, [{"status": "✅"}] * 800 + [{"status": "⚠️"}] * 200), "false alarm"
    # already-broken baseline is not re-alarmed forever
    broken = [{"status": "⚠️"}] * 900
    assert not detect_regressions(broken, broken), "re-alarm"
    # operational collapse is caught even without one dominant status
    collapsed = [{"status": "❌"}] * 400 + [{"status": "⚠️"}] * 400 + [{"status": "🔌"}] * 200
    assert detect_regressions(ok, collapsed), "operational collapse not caught"
    print("guard selftest OK")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return

    new = json.loads(Path(NEW_PATH).read_text(encoding="utf-8")).get("results", [])
    baseline = load_baseline()
    if baseline is None or len(baseline) < MIN_BASELINE:
        print("No usable baseline yet; skipping regression guard.")
        return

    findings = detect_regressions(baseline, new)
    if findings:
        print("Suspected classifier regression — aborting before commit/deploy:")
        for finding in findings:
            print(f"  - {finding}")
        sys.exit(1)

    print(f"Regression guard OK ({len(new)} results).")


if __name__ == "__main__":
    main()
