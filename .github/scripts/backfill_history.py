#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
#
# One-off utility (not run in CI). Rebuilds web/data/history.json from every
# committed revision of web/data/extensions.json so the trend chart has data
# immediately instead of waiting for future runs. Existing history entries win
# for their date, so the freshest live snapshot is preserved.
#
# Run:
#     .github/scripts/backfill_history.py
#     .github/scripts/backfill_history.py --selftest

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from record_history import (
    HISTORY_JSON,
    MAX_DAYS,
    tier_counts,
    upsert_day,
)

GIT_PATH = "web/data/extensions.json"


def committed_versions() -> list[tuple[str, str]]:
    """Return (sha, commit_date) newest-first for every revision of GIT_PATH.

    Returns:
        Commits touching the extensions JSON, newest first.
    """
    out = subprocess.run(
        ["git", "log", "--format=%H|%cI", "--", GIT_PATH],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    versions = []
    for line in out.splitlines():
        sha, _, date = line.partition("|")
        if sha and date:
            versions.append((sha, date))
    return versions


def select_daily(versions: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Keep the newest commit per UTC day. `versions` must be newest-first.

    Returns:
        One (sha, YYYY-MM-DD) pair per day, newest day first.
    """
    seen: set[str] = set()
    daily: list[tuple[str, str]] = []
    for sha, date in versions:
        day = date[:10]
        if day in seen:
            continue
        seen.add(day)
        daily.append((sha, day))
    return daily


def selftest() -> None:
    versions = [
        ("c", "2026-10-03T12:00:00+00:00"),
        ("b", "2026-10-03T06:00:00+00:00"),  # same day, older -> dropped
        ("a", "2026-10-02T23:00:00+00:00"),
    ]
    assert select_daily(versions) == [("c", "2026-10-03"), ("a", "2026-10-02")], select_daily(versions)
    print("backfill selftest OK")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return

    daily = select_daily(committed_versions())
    days: list[dict] = []
    for sha, day in reversed(daily):  # oldest first so upsert keeps chronological order
        raw = subprocess.run(
            ["git", "show", f"{sha}:{GIT_PATH}"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        try:
            results = json.loads(raw).get("results", [])
        except json.JSONDecodeError:
            continue
        if not results:
            continue
        days = upsert_day(days, day, tier_counts(results))

    # Existing live entries take precedence for their date.
    if HISTORY_JSON.exists():
        existing = json.loads(HISTORY_JSON.read_text(encoding="utf-8")).get("days", [])
        for entry in existing:
            if entry.get("date"):
                days = upsert_day(days, entry["date"], {k: v for k, v in entry.items() if k != "date"})

    days = days[-MAX_DAYS:]
    HISTORY_JSON.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_JSON.write_text(
        json.dumps({"generated": days[-1]["date"] if days else "", "days": days}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Backfilled {len(days)} days: {days[0]['date'] if days else '-'} .. {days[-1]['date'] if days else '-'}")


if __name__ == "__main__":
    main()
