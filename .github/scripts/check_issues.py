#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "aia",
#   "aiohttp[speedups]",
#   "anyio",
#   "beautifulsoup4[lxml]",
#   "dnspython[doh,idna]",
#   "publicsuffixlist",
#   "ua-generator",
#   "yarl",
# ]
# ///

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import random
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from operator import attrgetter
from typing import NamedTuple

import aiohttp
from anyio import Path
from common import (
    TIME_PRECISION_CUTOFF_SECONDS,
    TIMEOUT_CONNECT_SECONDS,
    TIMEOUT_SOCK_READ_SECONDS,
    TIMEOUT_TOTAL_SECONDS,
    Status,
    check_all_generic,
    check_url_generic,
    create_connector,
    format_duration,
    generate_headers,
)
from publicsuffixlist import PublicSuffixList  # type: ignore[import-untyped]
from yarl import URL

REPO = "keiyoushi/extensions-source"
LABELS = {"Source request", "Domain changed"}

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)
psl = PublicSuffixList()

URL_RE = re.compile(r"https?://[^\s\)>\]\"']+", re.IGNORECASE)
MD_LINK_RE = re.compile(r"\[(?:[^\]]+)\]\((https?://[^\s\)]+)\)", re.IGNORECASE)
BARE_URL_RE = re.compile(
    r"""
        (?:(?<=[\s(["])|^)
        (?:
            [0-9A-Za-z](?:[-0-9A-Za-z]*[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:[-0-9A-Za-z]*[0-9A-Za-z])?)+
        |
            (?:\d{1,3}\.){3}\d{1,3}
        |
            \[(?:[a-f0-9:]+:+)+[a-f0-9]+\]
        )
        (?::\d{1,5})?
        (?:\S*[)/0-9A-Za-z])?
    """,
    re.IGNORECASE | re.VERBOSE,
)
BLACKLIST_DOMAINS = {"github.blog", "github.com", "github.io", "tachiyomi.org"}
STRIKETHROUGH_RE = re.compile(r"~+[^~\n]+~+")
SOURCE_LINK_RES = [
    re.compile(r"###\s*Source\s+link\s*\n(.*?)(?=\n###|\n##|\Z)", re.IGNORECASE | re.DOTALL),
    re.compile(r"###\s*Source\s+new\s+URL\s*\n(.*?)(?=\n###|\n##|\Z)", re.IGNORECASE | re.DOTALL),
]


class PrUrl(NamedTuple):
    pr_number: int
    url: str
    label: str = ""
    is_bare: bool = False


@dataclass(frozen=True, slots=True)
class CheckResult:
    pr: PrUrl
    status: Status
    duration: float = -1.0
    info: str = ""
    subcategory: str = ""

    @property
    def sort_key(self) -> tuple[int, str]:
        return (-self.pr.pr_number, self.pr.url)


def extract_source_link_section(body: str) -> str:
    sections = []
    for pattern in SOURCE_LINK_RES:
        match = pattern.search(body)
        if match:
            sections.append(match.group(1))
    return "\n".join(sections)


def is_blacklisted(url: str) -> bool:
    return any(domain in url.lower() for domain in BLACKLIST_DOMAINS)


def extract_explicit_urls(text: str) -> set[str]:
    urls: set[str] = set()
    for match in MD_LINK_RE.finditer(text):
        url = match.group(1).rstrip(".,;:!?")
        if not is_blacklisted(url):
            urls.add(url)
    for match in URL_RE.finditer(text):
        url = match.group().rstrip(".,;:!?")
        if not is_blacklisted(url):
            urls.add(url)
    return urls


def extract_bare_urls(text: str) -> set[str]:
    urls: set[str] = set()
    for match in BARE_URL_RE.finditer(text):
        bare = match.group().rstrip(".,;:!?")
        if "](" in bare:
            bare = bare.split("](")[0]
        if is_blacklisted(bare):
            continue
        parsed = URL(f"https://{bare}")
        host = parsed.host or ""
        try:
            ipaddress.ip_address(host.strip("[]"))
            is_ip = True
        except ValueError:
            is_ip = False
        if is_ip or psl.privatesuffix(host, accept_unknown=False):
            urls.add(str(parsed))
    return urls


def extract_urls(text: str) -> tuple[set[str], bool]:
    text = STRIKETHROUGH_RE.sub("", text)
    urls = extract_explicit_urls(text)
    if urls:
        return urls, False
    return extract_bare_urls(text), True


def fetch_issues() -> list[dict]:
    seen: dict[int, dict] = {}
    for label in LABELS:
        cmd = [
            "gh",
            "issue",
            "list",
            "-R",
            REPO,
            "-l",
            label,
            "-s",
            "open",
            "-L",
            "1000",
            "--json",
            "body,labels,number",
        ]
        for issue in json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout):
            if issue["number"] not in seen:
                issue["label"] = ", ".join(lbl["name"] for lbl in issue["labels"] if lbl["name"] in LABELS)
                seen[issue["number"]] = issue
    return list(seen.values())


def extract_pr_urls(issues: list[dict]) -> list[PrUrl]:
    pr_urls: list[PrUrl] = []
    for issue in issues:
        number = issue["number"]
        body = issue.get("body") or ""
        label = issue.get("label", "")
        section = extract_source_link_section(body)
        urls, is_bare = extract_urls(section)
        if not urls:
            urls, is_bare = extract_urls(body)
        if urls:
            pr_urls.extend(PrUrl(number, url, label, is_bare) for url in urls)
        else:
            pr_urls.append(PrUrl(number, "", label))
    return sorted(pr_urls)


async def check_url(session: aiohttp.ClientSession, pr: PrUrl) -> CheckResult:
    if not pr.url:
        return CheckResult(pr, Status.NOT_FOUND)

    def make_result(status: Status, duration: float, info: str, subcategory: str) -> CheckResult:
        if pr.is_bare:
            info = f"{info}, Bare URL" if info else "Bare URL"
        return CheckResult(pr, status, duration, info, subcategory)

    return await check_url_generic(session, pr.url, make_result)


def log_result(result: CheckResult, pr: PrUrl) -> None:
    log.info("%s #%d (%s) %s", result.status, pr.pr_number, pr.url, result.info)


async def main() -> None:
    issues = fetch_issues()
    pr_urls = extract_pr_urls(issues)
    log.info("Checking %d URLs from %d issues", len(pr_urls), len(issues))

    seed = ",".join(f"{p.pr_number}:{p.url}" for p in pr_urls)
    headers = generate_headers(seed)

    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(
            total=TIMEOUT_TOTAL_SECONDS,
            connect=TIMEOUT_CONNECT_SECONDS,
            sock_read=TIMEOUT_SOCK_READ_SECONDS,
        ),
        headers=headers,
        connector=create_connector(),
    ) as session:
        pr_urls_shuffled = pr_urls.copy()
        random.shuffle(pr_urls_shuffled)
        results = await check_all_generic(session, pr_urls_shuffled, check_url, log_result)

    json_data = {
        "count": len(results),
        "timestamp": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "user_agent": headers["User-Agent"],
        "results": [
            {
                "status": r.status.value,
                "pr_number": r.pr.pr_number,
                "url": r.pr.url,
                "duration": round(r.duration, 3) if r.duration >= 0 else None,
                "time": format_duration(r.duration, TIME_PRECISION_CUTOFF_SECONDS),
                "labels": r.pr.label,
                "info": r.info,
                "subcategory": r.subcategory,
            }
            for r in sorted(results, key=attrgetter("sort_key"))
        ],
    }
    json_path = Path("web/data/issues.json")
    await json_path.parent.mkdir(parents=True, exist_ok=True)
    await json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
