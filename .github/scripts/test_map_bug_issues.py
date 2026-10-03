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

"""Self-check for the matching logic in matcher.py.

Covers romanization, source-name extraction, title splitting, and the
match_issue pipeline (URL host, exact name, fuzzy, superset suppression).

Run: uv run .github/scripts/test_map_bug_issues.py
"""

from __future__ import annotations

import json
import tempfile
from itertools import starmap
from pathlib import Path

import matcher as m
from ext_db import build_ext_db


def _entries(*pairs: tuple[str, str, str]) -> tuple[list[m.StatusEntry], list[str], dict[str, m.StatusEntry]]:
    entries = list(starmap(m.StatusEntry, pairs))
    names = [e.name for e in entries]
    hosts: dict[str, m.StatusEntry] = {}
    for e in entries:
        if not e.url:
            continue
        host = m.STRIP_WWW_RE.sub("", m.STRIP_PROTO_RE.sub("", e.url).split("/")[0].lower())
        hosts[host] = e
    return entries, names, hosts


def test_romanize() -> None:
    assert m.romanize("늑대닷컴") == ["neukdaedatkeom"], m.romanize("늑대닷컴")
    assert m.romanize("안녕하세요") == ["annyeonghaseyo"], m.romanize("안녕하세요")
    assert m.romanize("漫画") == ["manhua"], m.romanize("漫画")
    kana = m.romanize("ワンピース")
    assert kana, kana
    assert kana[0] != "ワンピース", kana
    assert not m.romanize("Read"), m.romanize("Read")


def test_extract_source_name() -> None:
    body = "### Source information\nExample Scans v1.2.3\n"
    assert m.extract_source_name(body) == "Example Scans", m.extract_source_name(body)
    assert not m.extract_source_name("no section here")


def test_title_to_names() -> None:
    assert m.title_to_names("[Bug] Foo / Bar - Baz") == ["Foo", "Bar"], m.title_to_names("[Bug] Foo / Bar - Baz")
    assert m.title_to_names("Some: Thing") == ["Some"], m.title_to_names("Some: Thing")


def test_match_url_host() -> None:
    entries, names, hosts = _entries(("ok", "Example Scans", "https://examplescans.com"))
    matches = m.match_issue(
        "Example Scans",
        "Example Scans down",
        "Site https://examplescans.com/series/1 is broken. https://github.com/keiyoushi/extensions-source",
        match_entries=entries,
        match_names=names,
        host_map=hosts,
        ext_db={},
    )
    assert len(matches) == 1, [(x.entry.name, x.methods) for x in matches]
    assert "url" in matches[0].methods, matches[0].methods
    assert matches[0].score >= 100.0


def test_match_hangul_slug() -> None:
    entries, names, hosts = _entries(("ok", "늑대닷컴 - 만화책", "https://wfwf507.com"))
    # parse_extensions_json appends the romanized slug; mirror that here.
    entries.append(entries[0])
    names.append(m.romanize(entries[0].name)[0])
    matches = m.match_issue(
        "neukdaedatkeom",
        "neukdaedatkeom is down",
        "",
        match_entries=entries,
        match_names=names,
        host_map=hosts,
        ext_db={},
    )
    assert any(x.entry.name == "늑대닷컴 - 만화책" for x in matches), [(x.entry.name, x.score) for x in matches]


def test_superset_suppression() -> None:
    entries, names, hosts = _entries(("ok", "Komga", "https://komga.org"), ("ok", "Komga (2)", "https://k2.org"))
    matches = m.match_issue(
        "Komga",
        "Komga is broken",
        "",
        match_entries=entries,
        match_names=names,
        host_map=hosts,
        ext_db={},
    )
    got = [x.entry.name for x in matches]
    assert got == ["Komga"], got


def test_parse_extensions_json() -> None:
    payload = {
        "results": [
            {"status": "ok", "name": "늑대닷컴", "url": "https://www.wfwf507.com"},
            {"status": "not_found", "name": "No Url", "url": ""},
        ]
    }
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "extensions.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        _, names, hosts = m.parse_extensions_json(path)
    assert "늑대닷컴" in names
    assert "neukdaedatkeom" in names, names
    assert "www.wfwf507.com" not in hosts, list(hosts)
    assert "wfwf507.com" in hosts, list(hosts)


def test_build_ext_db() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "src"
        ext = src / "foo"
        (ext / "src").mkdir(parents=True)
        (ext / "build.gradle").write_text('extName = "Foo Scan"\nextClass = ".FooSource"\n')
        (ext / "src" / "Foo.kt").write_text(
            'override val name: String = "Foo Alias"\n'
            'class Bar : BaseSource("Bar Name", 1)\n'
            'class Skip : UriPartFilter("nope")\n'
        )
        db = build_ext_db(src)
    assert db["foo scan"] == {("Foo Alias", "kt:name"), ("Bar Name", "kt:factory")}, db.get("foo scan")
    assert ("Foo Scan", "kt:class") in db["foosource"], db.get("foosource")
    assert ("Foo Scan", "kt:dir") in db["foo"], db.get("foo")
    assert "nope" not in {name for entries in db.values() for name, _ in entries}, db


def main() -> None:
    tests = [
        test_romanize,
        test_extract_source_name,
        test_title_to_names,
        test_match_url_host,
        test_match_hangul_slug,
        test_superset_suppression,
        test_parse_extensions_json,
        test_build_ext_db,
    ]
    for test in tests:
        test()
    print(f"OK: {len(tests)} map_bug_issues cases passed")


if __name__ == "__main__":
    main()
