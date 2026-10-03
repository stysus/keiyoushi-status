#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "korean-romanizer",
#   "pykakasi",
#   "pypinyin",
#   "rapidfuzz",
# ]
# ///

"""CLI: map open Bug issues to known extensions.

Fetches open `Bug` issues via `gh`, scores each against the extension index
(`matcher`), and writes `web/data/issue_map.json`. Matching logic lives in
`matcher.py`; the Kotlin/Gradle index lives in `ext_db.py`.

Run: .github/scripts/map_bug_issues.py
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from ext_db import build_ext_db
from matcher import IssueResult, extract_source_name, match_issue, parse_extensions_json

EXT_REPO = Path(os.getenv("EXT_REPO", "extensions-source")) / "src"
EXTENSIONS_JSON = Path(os.getenv("EXTENSIONS_JSON", "web/data/extensions.json"))
OUTPUT_JSON = Path(os.getenv("OUTPUT_JSON", "web/data/issue_map.json"))
REPO = os.getenv("SOURCE_REPO", "keiyoushi/extensions-source")
SKIP_LABELS = frozenset({"Meta request"})


def main() -> None:
    result = subprocess.run(
        [
            "gh",
            "issue",
            "list",
            "-R",
            REPO,
            "-l",
            "Bug",
            "-s",
            "open",
            "-L",
            "1000",
            "--json",
            "number,title,body,labels",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    issues = json.loads(result.stdout)
    match_entries, match_names, host_map = parse_extensions_json(EXTENSIONS_JSON)
    ext_db = build_ext_db(EXT_REPO)

    results: list[IssueResult] = []
    for issue in issues:
        if any(lbl["name"] in SKIP_LABELS for lbl in issue.get("labels", [])):
            continue
        body = issue["body"] or ""
        source_name = extract_source_name(body) or issue["title"]
        results.append(
            IssueResult(
                number=issue["number"],
                title=issue["title"],
                source_name=source_name,
                matches=match_issue(
                    source_name,
                    issue["title"],
                    body,
                    match_entries=match_entries,
                    match_names=match_names,
                    host_map=host_map,
                    ext_db=ext_db,
                ),
            ),
        )

    results.sort(key=lambda r: -r.number)
    matched = sum(1 for r in results if r.matches)

    json_data = {
        "total": len(results),
        "matched": matched,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "results": [
            {
                "number": r.number,
                "title": r.title,
                "source_name": r.source_name,
                "matches": [
                    {
                        "status": m.entry.status,
                        "name": m.entry.name,
                        "url": m.entry.url,
                        "score": round(m.score, 1),
                        "methods": list(m.methods),
                    }
                    for m in r.matches
                ],
            }
            for r in results
        ],
    }
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Total: {len(results)} | Matched: {matched} | No match: {len(results) - matched}")


if __name__ == "__main__":
    main()
