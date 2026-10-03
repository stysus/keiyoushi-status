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

When `web/data/history.json` has enough days, the operational-share check
compares against the median of recent days instead of the single previous day,
so one already-degraded baseline day cannot mask a real collapse.

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

from tiers import is_operational, tier_of

NEW_PATH = "web/data/extensions.json"
OLD_REF = "HEAD:web/data/extensions.json"
HISTORY_PATH = "web/data/history.json"
MIN_BASELINE = 200  # need enough history for shares to mean anything
STATUS_DELTA = 0.30  # a status may not grow by more than 30 points...
STATUS_FLOOR = 0.50  # ...and may not pass half of all results
OPERATIONAL_DROP = 0.25  # nor may operational share collapse by 25 points
MEDIAN_WINDOW = 7  # recent days used for the robust operational baseline
MIN_MEDIAN_DAYS = 3  # below this, fall back to the single previous day


def median(values: list[float]) -> float:
    """Return the median of values.

    Returns:
        The middle value (mean of the two middles for an even count), or 0.0 if empty.
    """
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def status_counts(results: list[dict]) -> Counter[str]:
    return Counter(item.get("status", "") for item in results)


def operational_share(results: list[dict]) -> float:
    if not results:
        return 0.0
    count = sum(1 for item in results if is_operational(tier_of(item.get("status", ""), item.get("subcategory") or "")))
    return count / len(results)


def detect_regressions(old: list[dict], new: list[dict], *, operational_baseline: float | None = None) -> list[str]:
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

    reference = operational_baseline if operational_baseline is not None else operational_share(old)
    new_operational = operational_share(new)
    drop = reference - new_operational
    if drop > OPERATIONAL_DROP:
        findings.append(f"operational share dropped {reference:.1%} -> {new_operational:.1%}")

    return findings


def load_operational_median() -> float | None:
    """Median operational share over recent history days, or None if too few.

    Returns:
        The median operational share, or None when history has fewer than
        MIN_MEDIAN_DAYS usable days.
    """
    try:
        days = json.loads(Path(HISTORY_PATH).read_text(encoding="utf-8")).get("days", [])
    except (OSError, json.JSONDecodeError):
        return None
    shares = [
        day["operational"] / day["total"]
        for day in days[-MEDIAN_WINDOW:]
        if day.get("total") and day.get("operational") is not None
    ]
    if len(shares) < MIN_MEDIAN_DAYS:
        return None
    return median(shares)


def load_baseline() -> list[dict] | None:
    try:
        raw = subprocess.run(["git", "show", OLD_REF], capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return json.loads(raw).get("results", [])


def selftest() -> None:
    ok = [{"status": "ok"} for _ in range(900)] + [{"status": "warning"} for _ in range(100)]
    # mass misclassification: warning jumps 10% -> 80%
    assert detect_regressions(ok, [{"status": "ok"}] * 200 + [{"status": "warning"}] * 800), "mass WARNING not caught"
    # a moderate, real shift stays below the alarm
    assert not detect_regressions(ok, [{"status": "ok"}] * 800 + [{"status": "warning"}] * 200), "false alarm"
    # already-broken baseline is not re-alarmed forever
    broken = [{"status": "warning"}] * 900
    assert not detect_regressions(broken, broken), "re-alarm"
    # operational collapse is caught even without one dominant status
    collapsed = [{"status": "error"}] * 400 + [{"status": "warning"}] * 400 + [{"status": "dns_error"}] * 200
    assert detect_regressions(ok, collapsed), "operational collapse not caught"
    # a single already-degraded baseline day can hide a real collapse from the
    # per-day check; the median baseline catches it
    broken_prev = [{"status": "error"}] * 700 + [{"status": "ok"}] * 300
    still_broken = [{"status": "error"}] * 800 + [{"status": "ok"}] * 200
    assert not detect_regressions(broken_prev, still_broken), "single-day baseline should miss this"
    assert detect_regressions(broken_prev, still_broken, operational_baseline=0.85), "median baseline missed collapse"
    assert not detect_regressions(
        ok, [{"status": "ok"}] * 850 + [{"status": "warning"}] * 150, operational_baseline=0.85
    )
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

    findings = detect_regressions(baseline, new, operational_baseline=load_operational_median())
    if findings:
        print("Suspected classifier regression — aborting before commit/deploy:")
        for finding in findings:
            print(f"  - {finding}")
        sys.exit(1)

    print(f"Regression guard OK ({len(new)} results).")


if __name__ == "__main__":
    main()
