#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "aia",
#   "aiohttp[speedups]",
#   "anyio",
#   "beautifulsoup4[lxml]",
#   "betterproto==2.0.0b7",
#   "dnspython[doh,idna]",
#   "publicsuffixlist",
#   "ua-generator",
#   "yarl",
# ]
# ///

from __future__ import annotations

import asyncio
import contextlib
import gzip
import json
import logging
import math
import os
import random
import sys
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
from generated import Index

REPO_INDEX_URL = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.pb"

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


class Source(NamedTuple):
    name: str
    url: str


@dataclass(frozen=True, slots=True)
class CheckResult:
    source: Source
    status: Status
    duration: float = -1.0
    info: str = ""
    subcategory: str = ""

    @property
    def sort_key(self) -> tuple[str, str]:
        return (self.source.name.lower(), self.source.url.lower())


def extract_sources(index: Index) -> list[Source]:
    sources = {
        Source(source.name, url)
        for extension in index.extension_list.extensions
        for source in extension.sources
        for url in (source.home_url, *source.mirror_urls)
        if url
    }
    return sorted(sources)


async def check_source(session: aiohttp.ClientSession, source: Source) -> CheckResult:
    def make_result(status: Status, duration: float, info: str, subcategory: str) -> CheckResult:
        return CheckResult(source, status, duration, info, subcategory)

    return await check_url_generic(session, source.url, make_result)


def log_result(result: CheckResult, source: Source) -> None:
    log.info("%s %s (%s) %s", result.status, source.name, source.url, result.info)


async def fetch_sources() -> list[Source]:
    async with aiohttp.ClientSession(connector=create_connector()) as session:
        log.info("Fetching repository index from %s", REPO_INDEX_URL)
        async with session.get(REPO_INDEX_URL) as resp:
            index = Index().parse(gzip.decompress(await resp.read()))
    return extract_sources(index)


async def get_shards_cli(chunk_size: int = 100) -> None:
    sources = await fetch_sources()
    total_sources = len(sources)
    total_shards = max(1, math.ceil(total_sources / chunk_size))
    payload = {
        "shards": list(range(total_shards)),
        "total_shards": total_shards,
        "total_sources": total_sources,
        "chunk_size": chunk_size,
    }
    print(json.dumps(payload))


DEFAULT_SHARDS_DIR = Path("web/data/shards")
DEFAULT_EXTENSIONS_JSON = Path("web/data/extensions.json")


async def merge_shards(
    shards_dir: Path = DEFAULT_SHARDS_DIR,
    output_path: Path = DEFAULT_EXTENSIONS_JSON,
) -> None:
    if not await shards_dir.exists():
        log.error("Shards directory %s does not exist", shards_dir)
        sys.exit(1)

    shard_files = [f async for f in shards_dir.glob("extensions_shard_*.json")]
    if not shard_files:
        log.error("No shard files found in %s", shards_dir)
        sys.exit(1)

    log.info("Merging %d shard files from %s", len(shard_files), shards_dir)
    all_results: list[dict] = []
    user_agent = ""
    latest_timestamp = ""

    for shard_file in shard_files:
        content = json.loads(await shard_file.read_text(encoding="utf-8"))
        all_results.extend(content.get("results", []))
        if not user_agent and content.get("user_agent"):
            user_agent = content["user_agent"]
        ts = content.get("timestamp", "")
        latest_timestamp = max(latest_timestamp, ts)

    all_results.sort(key=lambda r: (r.get("name", "").lower(), r.get("url", "").lower()))

    final_data = {
        "count": len(all_results),
        "timestamp": latest_timestamp or datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "user_agent": user_agent,
        "results": all_results,
    }

    await output_path.parent.mkdir(parents=True, exist_ok=True)
    await output_path.write_text(json.dumps(final_data, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Successfully merged %d results into %s", len(all_results), output_path)

    for shard_file in shard_files:
        await shard_file.unlink()
    with contextlib.suppress(OSError):
        await shards_dir.rmdir()


async def main() -> None:
    sources = await fetch_sources()
    total_sources = len(sources)

    shard_index = int(os.getenv("SHARD_INDEX", "0"))
    total_shards = int(os.getenv("TOTAL_SHARDS", "1"))

    if total_shards > 1:
        chunk_size = math.ceil(total_sources / total_shards)
        start = shard_index * chunk_size
        end = min(start + chunk_size, total_sources)
        sources = sources[start:end]
        log.info(
            "Running shard %d of %d: checking %d sources (indices %d to %d)",
            shard_index + 1,
            total_shards,
            len(sources),
            start,
            end,
        )
        json_path = Path(f"web/data/extensions_shard_{shard_index}.json")
    else:
        log.info("Checking %d unique sources in single-runner mode", len(sources))
        json_path = Path("web/data/extensions.json")

    seed = ",".join(f"{s.name}:{s.url}" for s in sources)
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
        sources_shuffled = sources.copy()
        random.shuffle(sources_shuffled)
        results = await check_all_generic(session, sources_shuffled, check_source, log_result)

    json_data = {
        "count": len(results),
        "timestamp": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "user_agent": headers["User-Agent"],
        "results": [
            {
                "status": r.status.value,
                "name": r.source.name,
                "url": r.source.url,
                "duration": round(r.duration, 3) if r.duration >= 0 else None,
                "time": format_duration(r.duration, TIME_PRECISION_CUTOFF_SECONDS),
                "info": r.info,
                "subcategory": r.subcategory,
            }
            for r in sorted(results, key=attrgetter("sort_key"))
        ],
    }
    await json_path.parent.mkdir(parents=True, exist_ok=True)
    await json_path.write_text(json.dumps(json_data, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Saved %d results to %s", len(results), json_path)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--get-shards":
        chunk_size = int(args[1]) if len(args) > 1 else 100
        asyncio.run(get_shards_cli(chunk_size))
    elif args and args[0] == "--merge":
        output = Path(args[1]) if len(args) > 1 else DEFAULT_EXTENSIONS_JSON
        shards = Path(args[2]) if args[2:] else DEFAULT_SHARDS_DIR
        asyncio.run(merge_shards(shards, output))
    else:
        asyncio.run(main())
