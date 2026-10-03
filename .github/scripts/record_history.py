#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""Append today's tier snapshot to web/data/history.json.

One entry per UTC date (later runs the same day overwrite it), capped to the
most recent MAX_DAYS days so the file stays small. Tier logic mirrors
web/js/config.js getTierCategory().

Run:
    .github/scripts/record_history.py
    .github/scripts/record_history.py --selftest
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from operator import itemgetter
from pathlib import Path

EXTENSIONS_JSON = Path("web/data/extensions.json")
HISTORY_JSON = Path("web/data/history.json")
MAX_DAYS = 90


def tier_counts(results: list[dict]) -> dict[str, int]:
    counts = {"total": 0, "ok": 0, "challenge": 0, "degraded": 0, "offline": 0}
    for item in results:
        status = item.get("status", "")
        subcategory = (item.get("subcategory") or "").lower()
        counts["total"] += 1
        if status == "ok":
            counts["ok"] += 1
        elif status in {"iuam", "waf"} or (status == "redirect" and "same authority" in subcategory):
            counts["challenge"] += 1
        elif status in {"rate_limited", "warning"}:
            counts["degraded"] += 1
        else:
            counts["offline"] += 1
    counts["operational"] = counts["ok"] + counts["challenge"]
    return counts


def upsert_day(days: list[dict], date: str, snapshot: dict) -> list[dict]:
    days = [d for d in days if d.get("date") != date]
    days.append({"date": date, **snapshot})
    days.sort(key=itemgetter("date"))
    return days[-MAX_DAYS:]


def selftest() -> None:
    results = [
        {"status": "ok"},
        {"status": "iuam"},
        {"status": "redirect", "subcategory": "Same Authority"},
        {"status": "redirect", "subcategory": "Meta Refresh"},
        {"status": "warning"},
        {"status": "error"},
    ]
    counts = tier_counts(results)
    assert counts == {"total": 6, "ok": 1, "challenge": 2, "degraded": 1, "offline": 2, "operational": 3}, counts

    days = upsert_day([], "2026-10-01", counts)
    days = upsert_day(days, "2026-10-02", counts)
    days = upsert_day(days, "2026-10-01", {"total": 1})  # overwrite same date
    assert [d["date"] for d in days] == ["2026-10-01", "2026-10-02"], days
    assert days[0]["total"] == 1, days

    many = upsert_day([{"date": f"d{i:03d}"} for i in range(200)], "zzz", {"total": 0})
    assert len(many) == MAX_DAYS, len(many)
    assert many[-1]["date"] == "zzz", many[-1]
    print("record_history selftest OK")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return

    if not EXTENSIONS_JSON.exists():
        print(f"{EXTENSIONS_JSON} not found; nothing to record.")
        return

    results = json.loads(EXTENSIONS_JSON.read_text(encoding="utf-8")).get("results", [])
    date = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    snapshot = tier_counts(results)

    history = {"generated": "", "days": []}
    if HISTORY_JSON.exists():
        history = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
    history["days"] = upsert_day(history.get("days", []), date, snapshot)
    history["generated"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")

    HISTORY_JSON.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_JSON.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Recorded {date}: {snapshot} ({len(history['days'])} days)")


if __name__ == "__main__":
    main()
