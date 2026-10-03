"""Build the extension-name index from the extensions-source checkout.

Scans each `build.gradle` and its Kotlin sources for the names a bug report
might use (extName, extClass, directory slug, factory display names) and keys
them for lookup by `matcher.match_issue`. Filesystem-only, no third-party deps.

Run: imported by map_bug_issues.py.
"""

from __future__ import annotations

import re
from pathlib import Path

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
