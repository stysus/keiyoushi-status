#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pykakasi",
#   "pypinyin",
#   "rapidfuzz",
# ]
# ///

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pykakasi import kakasi
from pypinyin import lazy_pinyin
from rapidfuzz import fuzz, process
from rapidfuzz import utils as fuzz_utils

EXT_REPO = Path(os.getenv("EXT_REPO", "extensions-source")) / "src"
EXTENSIONS_JSON = Path(os.getenv("EXTENSIONS_JSON", "web/data/extensions.json"))
OUTPUT_JSON = Path(os.getenv("OUTPUT_JSON", "web/data/issue_map.json"))
REPO = os.getenv("SOURCE_REPO", "keiyoushi/extensions-source")
SCORE_CUTOFF = 90
SKIP_LABELS = frozenset({"Meta request"})

CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]")
PKG_ID_RE = re.compile(r"\b\w{2}\.\w+")  # e.g. co.navercomic, id.shinigami
EXT_NAME_RE = re.compile(r"""extName\s*=\s*['"](.+?)['"]""")
EXT_CLASS_RE = re.compile(r"""extClass\s*=\s*['"]\s*\.?(\w+)['"]""")
KT_NAME_RE = re.compile(r"""override\s+val\s+name(?:\s*:\s*\w+)?\s*=\s*['"](.+?)['"]""")
KT_CLASS_DEF_RE = re.compile(
    r"""^class\s+(\w+)(?:\s*\([^)]*\))?\s*:\s*([A-Z]\w*)\s*\(\s*['"]([ \w][^'"]{1,48})['"]""",
    re.MULTILINE,
)
# Parent class names matching this pattern are filter/UI helpers, not source base classes.
# e.g. UriPartFilter, SlugGroupFilter, SlugSelectFilter, Filter
KT_FILTER_PARENT_RE = re.compile(r"(?i)filter|select|tristate|checkbox|chip")
URL_RE = re.compile(r"https?://[^\s\)\]>\"']+", re.IGNORECASE)

SOURCE_INFO_RE = re.compile(
    r"###\s*Source\s+(?:information|name)\s*\n(.*?)(?=\n###|\n##|\Z)",
    re.IGNORECASE | re.DOTALL,
)
VERSION_RE = re.compile(r"(?:\s+-\s+|\s+)v?\d[\d.]*(?:/\d+)?\s*$", re.IGNORECASE)
KANA_RE = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")
STRIP_PROTO_RE = re.compile(r"^https?://")
STRIP_WWW_RE = re.compile(r"^(www\.)?")
SLUG_NORM_RE = re.compile(r"[\s\-_]+")
EXT_NAME_PREFIX_RE = re.compile(r"^Extension\s+name:\s*", re.IGNORECASE)
SOURCE_SPLIT_RE = re.compile(r"[;(]")
AMP_SPLIT_RE = re.compile(r"\s*[&,/]\s*")
VERSION_ONLY_RE = re.compile(r"v?\d[\d.]*", re.IGNORECASE)
IGNORE_LINE_RE = re.compile(r"^(the\s+plugin|version\b)", re.IGNORECASE)
TRAILING_VER_RE = re.compile(r"(?<=[a-zA-Z\u4e00-\u9fff])\d+\.\d[\d.]*$")
TRAILING_V_RE = re.compile(r"\s+v$", re.IGNORECASE)
TITLE_TAG_RE = re.compile(r"^\[.*?\]\s*")
TITLE_SPLIT_RE = re.compile(r"^(.+?)(?:\s*:\s|\s+-\s)")
TITLE_SLASH_RE = re.compile(r"\s*/\s*")

_kakasi = kakasi()


@dataclass(frozen=True, slots=True)
class StatusEntry:
    emoji: str
    name: str
    url: str


@dataclass(frozen=True, slots=True)
class Match:
    entry: StatusEntry
    score: float
    methods: tuple[
        str,
        ...,
    ]  # "url" | "gh:body→extName" | "gh:title→extName" | "gh:body→kt:name" | "gh:body→kt:factory" | "gh:body→kt:class" | "gh:body→kt:dir"


@dataclass
class IssueResult:
    number: int
    title: str
    source_name: str
    matches: list[Match] = field(default_factory=list)


def romanize(text: str) -> list[str]:
    has_kana = bool(KANA_RE.search(text))
    slugs: list[str] = []
    if not has_kana:
        s = "".join(lazy_pinyin(text)).lower()
        if s and s != text.lower():
            slugs.append(s)
    else:
        s = "".join(item["hepburn"] for item in _kakasi.convert(text)).lower()
        if s and s != text.lower() and s not in slugs:
            slugs.append(s)
    return slugs


def build_ext_db(src: Path) -> dict[str, set[tuple[str, str]]]:
    db: dict[str, set[tuple[str, str]]] = {}
    for gradle in src.rglob("build.gradle"):
        gradle_text = gradle.read_text(errors="ignore")
        m = EXT_NAME_RE.search(gradle_text)
        if not m:
            continue
        ext_name = m.group(1)
        mc = EXT_CLASS_RE.search(gradle_text)
        ext_class_name = mc.group(1) if mc else None
        kt_entries: set[tuple[str, str]] = set()
        for kt in gradle.parent.rglob("*.kt"):
            text = kt.read_text(errors="ignore")
            kt_entries.update((km.group(1), "kt:name") for km in KT_NAME_RE.finditer(text))
            # Factory pattern: class VCP : VerComics("VCP", ...) - capture display names
            # from classes inheriting non-filter base classes.
            # Require name to start uppercase to exclude ISO language codes ("af", "fr", "id" ...)
            # which MangaDex and similar factory extensions pass as the first constructor arg.
            for km in KT_CLASS_DEF_RE.finditer(text):
                if not KT_FILTER_PARENT_RE.search(km.group(2)) and km.group(3)[0].isupper():
                    kt_entries.add((km.group(3), "kt:factory"))
        db[ext_name.lower()] = kt_entries
        # Also allow lookup by extClass name (e.g. "MangaGun" → {"NihonKuni"})
        if ext_class_name:
            class_key = ext_class_name.lower()
            if class_key != ext_name.lower():
                db.setdefault(class_key, set()).add((ext_name, "kt:class"))
        # Also index by directory slug (e.g. "spectralscan" → {"Nexus Toons"})
        dir_key = gradle.parent.name.lower()
        if dir_key != ext_name.lower():
            db.setdefault(dir_key, set()).add((ext_name, "kt:dir"))
    return db


def parse_extensions_json(path: Path) -> tuple[list[StatusEntry], list[str], dict[str, StatusEntry]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    results = payload.get("results", []) if isinstance(payload, dict) else payload
    base = [
        StatusEntry(
            emoji=item.get("status", ""),
            name=item.get("name", "").strip(),
            url=item.get("url", "").strip(),
        )
        for item in results
        if item.get("name")
    ]

    match_entries: list[StatusEntry] = list(base)
    match_names: list[str] = [e.name for e in base]
    for e in base:
        if CJK_RE.search(e.name):
            for slug in romanize(e.name):
                match_entries.append(e)
                match_names.append(slug)

    host_map: dict[str, StatusEntry] = {
        STRIP_WWW_RE.sub("", STRIP_PROTO_RE.sub("", e.url).split("/")[0].lower()): e for e in base if e.url
    }
    return match_entries, match_names, host_map


def extract_source_name(body: str) -> str:
    m = SOURCE_INFO_RE.search(body)
    if not m:
        return ""
    for raw_line in m.group(1).splitlines():
        line = raw_line.strip().strip("\"'")
        if not line:
            continue
        line = EXT_NAME_PREFIX_RE.sub("", line)
        line = SOURCE_SPLIT_RE.split(line)[0].strip()
        line = VERSION_RE.sub("", line).strip()
        if VERSION_ONLY_RE.fullmatch(line):
            continue
        if IGNORE_LINE_RE.match(line):
            continue
        line = TRAILING_VER_RE.sub("", line).strip()
        line = TRAILING_V_RE.sub("", line).strip()
        line = line.replace("_", " ")
        if line:
            return line
    return ""


def title_to_names(title: str) -> list[str]:
    title = TITLE_TAG_RE.sub("", title)
    m = TITLE_SPLIT_RE.match(title)
    part = m.group(1).strip() if m else title
    return [n.strip() for n in TITLE_SLASH_RE.split(part) if n.strip()]


def match_issue(
    source_name: str,
    title: str,
    body: str,
    *,
    match_entries: list[StatusEntry],
    match_names: list[str],
    host_map: dict[str, StatusEntry],
    ext_db: dict[str, set[tuple[str, str]]],
) -> list[Match]:
    seen: dict[str, Match] = {}

    # 1. URL host → exact match
    for raw_url in URL_RE.findall(body):
        url = raw_url.rstrip(".,;")
        if "github.com" in url or "tachiyomi" in url:
            continue
        stripped = STRIP_PROTO_RE.sub("", url).split("?")[0].rstrip("/").lower()
        host = STRIP_WWW_RE.sub("", stripped.split("/")[0])
        if host in host_map and host_map[host].name not in seen:
            seen[host_map[host].name] = Match(host_map[host], 100.0, ("url",))

    # 2. source name + title parts + Kotlin name aliases
    # Kotlin alias lookup only fires when source_name is a package ID (e.g. co.navercomic)
    source_parts = [
        p
        for part in AMP_SPLIT_RE.split(source_name)
        if (p := TRAILING_VER_RE.sub("", VERSION_RE.sub("", part).strip()).strip()) and not VERSION_ONLY_RE.fullmatch(p)
    ]
    title_names = [n for n in title_to_names(title) if n.lower() not in {p.lower() for p in source_parts}]
    queries: list[tuple[str, str]] = [
        *((p, "gh:body→extName") for p in source_parts),
        *((n, "gh:title→extName") for n in title_names),
    ]
    # Look up by exact name, extClass, or dir slug (slug strips spaces/hyphens for e.g. "Spectral Scan" → "spectralscan")
    slug = SLUG_NORM_RE.sub("", source_name.lower())
    kt_entries = ext_db.get(source_name.lower(), set()) | ext_db.get(slug, set())
    # For pkg-style IDs (e.g. "Fr.softepsilonscan"), also look up the suffix after the dot
    if PKG_ID_RE.match(source_name):
        pkg_suffix = source_name.lower().split(".", 1)[-1]
        kt_entries |= ext_db.get(pkg_suffix, set())
    queries.extend(
        (kt_name, f"gh:body→{kind}") for kt_name, kind in kt_entries if kt_name.lower() != source_name.lower()
    )

    for query, method in queries:
        for _matched_name, score, idx in process.extract(
            query,
            match_names,
            scorer=fuzz.token_set_ratio,
            processor=fuzz_utils.default_process,
            limit=3,
            score_cutoff=SCORE_CUTOFF,
        ):
            e = match_entries[idx]
            if e.name not in seen:
                seen[e.name] = Match(e, score, (method,))
            elif method not in seen[e.name].methods:
                existing = seen[e.name]
                seen[e.name] = Match(existing.entry, max(existing.score, score), (*existing.methods, method))

    # If a case-insensitive exact match exists at 100% (non-URL), suppress other 100% non-URL
    # token-set superset noise (e.g. "Komga" → drop "Komga (2)", "Komga (3)").
    # Normalize with SLUG_NORM_RE so "Weeb Central" matches query "WeebCentral".
    source_parts_norm = {SLUG_NORM_RE.sub("", p.lower()) for p in source_parts}

    def _norm(name: str) -> str:
        return SLUG_NORM_RE.sub("", name.lower())

    if any(
        m.score >= 100 and "url" not in m.methods and _norm(m.entry.name) in source_parts_norm for m in seen.values()
    ):
        seen = {
            n: m
            for n, m in seen.items()
            if "url" in m.methods or m.score < 100 or _norm(m.entry.name) in source_parts_norm
        }

    # URL matches first, then by score descending
    return sorted(seen.values(), key=lambda m: ("url" not in m.methods, -m.score))


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

    json_data = {
        "total": len(results),
        "matched": sum(1 for r in results if r.matches),
        "timestamp": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "results": [
            {
                "number": r.number,
                "title": r.title,
                "source_name": r.source_name,
                "matches": [
                    {
                        "status": m.entry.emoji,
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

    matched = sum(1 for r in results if r.matches)
    print(f"Total: {len(results)} | Matched: {matched} | No match: {len(results) - matched}")


if __name__ == "__main__":
    main()
