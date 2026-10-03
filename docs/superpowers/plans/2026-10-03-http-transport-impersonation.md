# HTTP Transport Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the aiohttp fetch layer with `curl_cffi` browser impersonation (TLS/JA3 + HTTP/2) so challenge/block classifications reflect real availability, while keeping the per-TLD DoH routing.

**Architecture:** A new stdlib-only `dns.py` owns nameserver pools, TLD routing, and weighted candidate selection. `transport.py` drives a `curl_cffi.AsyncSession` (impersonate chrome, http/2) and passes a per-request `doh_url` chosen from `dns.py`. `classify.py` remaps its exception classifier to curl error codes. Callers only swap `create_connector()` for `create_session()`.

**Tech Stack:** Python 3.11+, `curl_cffi` (curl-impersonate), PEP723 inline scripts, `uv`.

**Spec:** `docs/superpowers/specs/2026-10-03-http-transport-impersonation-design.md`

## Global Constraints

- No new runtime/test dependencies beyond `curl_cffi` (spec dependency delta).
- Remove: `aiohttp[speedups]`, `aia`, `dnspython[doh,idna]`, `httpx[http2]`, `ua-generator`.
- Keep: `beautifulsoup4[lxml]`, `publicsuffixlist`, `yarl`, `betterproto==2.0.0b7`, `anyio`.
- JSON schema unchanged: `extensions.json` / `issues.json` / `history.json` field names and order stay identical. `web/js` untouched.
- `tiers.py`, `guard_regression.py`, `record_history.py` unchanged.
- Retry: max 3 attempts, backoff `0.5s * 2^(n-1)` + jitter, `Retry-After` capped at 5s. Retry curl network codes (6/7/28/52/56), HTTP 5xx, HTTP 429. Do not retry 403/challenge, SSL cert (60), other 4xx.
- Concurrency: `max_clients=80` global, per-host limit 3.
- Impersonation target: `"chrome"`, `http_version="v2"`.
- Proxy: `curl_cffi` reads `HTTP_PROXY`/`HTTPS_PROXY` from the environment automatically; no code path is added. CI may set a proxy secret if the datacenter IP stays challenged.
- Observability: `http_version`/`impersonate` are logged only, never added to the JSON records (keeps the data schema and `web/js` untouched).
- All scripts stay runnable via `uv run`; ruff must pass (`uvx ruff check .github/scripts/`).

## Review Focus

1. **Host with no resolvable DoH candidate** (empty or malformed host): `dns.DoHRouter.candidates_for` must still return the global pool, never an empty list.
2. **Absurd `Retry-After`** (e.g. `99999`): the retry sleep must be capped at 5s, not honored literally.
3. **Redirect chain over the limit** (curl code 47): must classify as a `redirect`-loop `WARNING`, not a generic error.
4. **Missing `Content-Type`**: `classify_response` must treat a bodyless/unknown-type 200 as `ok` with a `Binary` subcategory, not crash.
5. **One host repeated concurrently** (many mirrors on one host): the per-host limiter must return the same semaphore for the same host and cap concurrency at 3.

---

### Task 1: `dns.py` pure DoH router + tests

**Files:**
- Create: `.github/scripts/dns.py`
- Create: `.github/scripts/test_dns.py`
- Modify: `.github/workflows/status.yaml` (selfcheck job, after the tier step)

**Interfaces:**
- Consumes: nothing (stdlib only).
- Produces:
  - `DNS_NAMESERVERS_GLOBAL: list[str]`, `DNS_NAMESERVERS_RU/ZH/JP: list[str]` (URLs copied verbatim from the current `transport.py`)
  - `DNS_TLDS_RU: tuple[str, ...] = (".ru", ".su", ".by", ".kz")`, `DNS_TLDS_ZH = (".cn", ".top", ".wang", ".xin", ".site")`, `DNS_TLDS_JP = (".jp",)`
  - `DNS_MAX_ATTEMPTS: int = 3`
  - `class NameserverScore` with `weight: float` and `reward() -> None` / `penalize() -> None`
  - `def weighted_sample_without_replacement(pool: list[tuple[str, float]], k: int, rng: random.Random) -> list[str]`
  - `class DoHRouter` with `__init__(self, *, nameservers=None, ru_nameservers=None, zh_nameservers=None, jp_nameservers=None, rng=None) -> None`, `candidates_for(self, host: str) -> list[str]`, `reward(self, url: str) -> None`, `penalize(self, url: str) -> None`

- [ ] **Step 1: Write the failing test**

`.github/scripts/test_dns.py` (PEP723, `dependencies = []`, executable, shebang `#!/usr/bin/env -S uv run --script`):

```python
from __future__ import annotations

import random

from dns import DNS_NAMESERVERS_GLOBAL, DNS_NAMESERVERS_JP, DNS_NAMESERVERS_RU, DNS_NAMESERVERS_ZH, DoHRouter


def main() -> None:
    router = DoHRouter(rng=random.Random(0))

    ru = router.candidates_for("example.ru")
    assert ru[0] in DNS_NAMESERVERS_RU, ru
    assert len(ru) == len(set(ru)), ru

    zh = router.candidates_for("example.cn")
    assert zh[0] in DNS_NAMESERVERS_ZH, zh

    jp = router.candidates_for("example.jp")
    assert jp[0] in DNS_NAMESERVERS_JP, jp

    gl = router.candidates_for("example.com")
    assert gl[0] in DNS_NAMESERVERS_GLOBAL, gl
    assert set(DNS_NAMESERVERS_GLOBAL) <= set(gl), gl  # global pool fully available

    # Review Focus 1: unknown/empty host still yields a usable global pool
    assert router.candidates_for("")[:1] and router.candidates_for("")[0] in DNS_NAMESERVERS_GLOBAL

    # weighted selection is deterministic for a fixed rng and never repeats a nameserver
    assert DoHRouter(rng=random.Random(1)).candidates_for("a.ru") == DoHRouter(rng=random.Random(1)).candidates_for("a.ru")

    # scores stay within [0.1, 3.0]
    url = DNS_NAMESERVERS_GLOBAL[0]
    for _ in range(50):
        router.reward(url)
    assert router._scores[url].weight <= 3.0
    for _ in range(50):
        router.penalize(url)
    assert router._scores[url].weight >= 0.1

    print("dns selftest OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/mbrx/Coding/tool/keiyoushi-status && python3 .github/scripts/test_dns.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'dns'`

- [ ] **Step 3: Implement `dns.py`**

Copy the four nameserver lists, the three TLD tuples, `DNS_MAX_ATTEMPTS`, the weight constants, `NameserverScore`, and `weighted_sample_without_replacement` verbatim from the current `transport.py` (lines 55–150), renaming `_NameserverScore` → `NameserverScore`. Then add:

```python
class DoHRouter:
    """Ordered DoH candidates per host, with weighted, rewarded selection."""

    def __init__(self, *, nameservers=None, ru_nameservers=None, zh_nameservers=None, jp_nameservers=None, rng=None) -> None: ...
    def candidates_for(self, host: str) -> list[str]: ...
    def reward(self, url: str) -> None: ...
    def penalize(self, url: str) -> None: ...
```

`candidates_for` reproduces the current `_get_nameservers_for_host` ordering: pick the TLD pool as primary, then global (or the remaining pools) as secondary, then the rest as tertiary; return the de-duplicated concatenation. Hosts with no matching TLD use the global pool as primary. An empty/unrecognized host must still return the global pool. Selection uses `self._rng` so a fixed seed is deterministic.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 .github/scripts/test_dns.py`
Expected: `dns selftest OK`

- [ ] **Step 5: Wire into selfcheck**

In `.github/workflows/status.yaml`, in the `selfcheck` job after the tier step, add:

```yaml
      - name: Run DNS router self-checks
        run: .github/scripts/test_dns.py
```

- [ ] **Step 6: Commit**

```bash
git add .github/scripts/dns.py .github/scripts/test_dns.py .github/workflows/status.yaml
git commit -m "feat(scripts): pure per-TLD DoH router for the curl_cffi transport"
```

---

### Task 2: Swap transport to curl_cffi (atomic risk phase)

**Files:**
- Modify: `.github/scripts/transport.py` (rewrite client + fetch + retry)
- Modify: `.github/scripts/classify.py:1-30,434-478` (imports + exception classifier)
- Modify: `.github/scripts/test_classify.py` (deps + curl exception fixtures)
- Create: `.github/scripts/test_transport.py`
- Modify: `.github/scripts/check_extensions.py` (session + imports + PEP723)
- Modify: `.github/scripts/check_issues.py` (session + imports + PEP723)
- Modify: `.github/workflows/status.yaml` (selfcheck: add transport step)

**Interfaces:**
- Consumes from Task 1: `dns.DoHRouter`, `dns.DNS_MAX_ATTEMPTS`.
- Produces:
  - `transport.IMPERSONATE: str = "chrome"`, `transport.USER_AGENT_LABEL: str = "chrome (curl_cffi)"`
  - `transport.MAX_CONCURRENT = 80`, `PER_HOST_LIMIT = 3`, `RETRY_ATTEMPTS = 3`, `RETRY_BACKOFF_SECONDS = 0.5`, `RETRY_AFTER_CAP_SECONDS = 5.0`, `TIME_PRECISION_CUTOFF_SECONDS = 10`, `TIMEOUT_TOTAL_SECONDS = 45`
  - `transport.create_session() -> curl_cffi.AsyncSession`
  - `transport.is_retryable_status(code: int) -> bool`
  - `transport._retry_after_seconds(headers: Mapping[str, str], cap: float = RETRY_AFTER_CAP_SECONDS) -> float | None`
  - `transport._host_semaphore(host: str) -> asyncio.Semaphore`
  - `transport.check_url_generic(session, url, make_result, *, attempts=RETRY_ATTEMPTS) -> R` (unchanged signature)
  - `transport.check_all_generic(session, items, check_fn, log_fn) -> list[R]` (unchanged signature)
  - `classify.classify_exception(e) -> Classification`, `classify.is_retryable(e) -> bool` (remapped to curl codes)
  - `transport.record`, `transport.format_duration`, `transport.UrlCheck` unchanged.

- [ ] **Step 1: Write the failing transport helper test**

`.github/scripts/test_transport.py` (PEP723 `dependencies = ["curl_cffi"]`, executable):

```python
from __future__ import annotations

import asyncio

import transport


def main() -> None:
    assert transport.is_retryable_status(500) and transport.is_retryable_status(429)
    assert not transport.is_retryable_status(403) and not transport.is_retryable_status(404)

    # Review Focus 2: absurd Retry-After is capped
    assert transport._retry_after_seconds({"retry-after": "99999"}) == 5.0
    assert transport._retry_after_seconds({"retry-after": "2"}) == 2.0
    assert transport._retry_after_seconds({}) is None
    assert transport._retry_after_seconds({"retry-after": "soon"}) is None

    # Review Focus 5: same host -> same semaphore, distinct hosts -> distinct
    assert transport._host_semaphore("a.test") is transport._host_semaphore("a.test")
    assert transport._host_semaphore("a.test") is not transport._host_semaphore("b.test")
    assert transport._host_semaphore("a.test")._value == 3

    print("transport selftest OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/mbrx/Coding/tool/keiyoushi-status && PYTHONPATH=.github/scripts uv run .github/scripts/test_transport.py`
Expected: FAIL — `AttributeError: module 'transport' has no attribute 'is_retryable_status'`

- [ ] **Step 3: Remap `classify.py` exception handling to curl_cffi**

Replace the `aiohttp` import with `from curl_cffi.requests import errors as curl_errors`; drop now-unused `asyncio`, `socket`, `ssl` imports if nothing else uses them (verify with grep before removing). Replace `RETRYABLE_EXCEPTIONS`/`NON_RETRYABLE_EXCEPTIONS`/`is_retryable`/`classify_exception` with curl-code logic:

```python
RETRYABLE_CURL_CODES = frozenset({6, 7, 28, 52, 56})  # resolve/connect/timeout/empty-reply/recv
SSL_CURL_CODES = frozenset({35, 60})
REDIRECT_LOOP_CODE = 47
DNS_CURL_CODE = 6
TIMEOUT_CURL_CODE = 28


def _curl_code(e: Exception) -> int | None:
    return getattr(e, "code", None)


def is_retryable(e: Exception) -> bool:
    """True for transient curl network failures; False for deterministic errors."""
    return _curl_code(e) in RETRYABLE_CURL_CODES


def classify_exception(e: Exception) -> Classification:
    """Classify a fetch exception (curl_cffi) into a status/subcategory."""
```

`classify_exception` returns: code 47 → `Classification(Status.WARNING, "Redirect Loop", str(e))`; code 6 → `DNS_ERROR, "DNS Failure"`; code in SSL_CURL_CODES → `ERROR, "SSL Error"`; code 28 → `ERROR, "Timeout"`; else `ERROR, "Connection Failed"`. Also accept `TimeoutError`/`asyncio.TimeoutError` strings as today as a fallback (`"timeout" in str(e).lower()` → Timeout).

- [ ] **Step 4: Rewrite `transport.py`**

Remove the aiohttp/dnspython/httpx/ua_generator/aia imports and every DNS class (`_NameserverScore`, `_PersistentDoHNameserver`, `DNSPythonResolver`, `_DoHTCPConnector`, `create_connector`) plus `generate_headers`, `_build_aia_ssl_context`, `_aia_session`. Import from Task 1:

```python
from curl_cffi import AsyncSession, CurlHttpVersion
from dns import DoHRouter
```

Add a module-level `_router = DoHRouter()` and helpers. Then:

- `create_session()` → `AsyncSession(impersonate=IMPERSONATE, http_version="v2", max_clients=MAX_CONCURRENT, timeout=TIMEOUT_TOTAL_SECONDS)`.
- `_fetch_snapshot(session, url, *, doh_url: str | None = None) -> _ResponseSnapshot`: `resp = await session.get(url, doh_url=doh_url, allow_redirects=True)`; build the snapshot from `resp.status_code`, `str(resp.url)`, `resp.headers.get("content-type", "")`, `{k.lower(): v for k, v in resp.headers.items()}`, and the decoded body (reuse `BINARY_CONTENT_PREFIXES` + `MAX_BODY_BYTES`; `resp.content` is bytes). No AIA fallback (spec: deferred to Task 4).
- `is_retryable_status(code)` → `code == 429 or 500 <= code < 600`.
- `_retry_after_seconds(headers, cap=RETRY_AFTER_CAP_SECONDS)` → parse the `retry-after` header as a float seconds; return `min(value, cap)` or `None` when absent/unparseable/negative.
- `_host_semaphore(host)` → cached `asyncio.Semaphore(PER_HOST_LIMIT)` keyed by host in a module dict.
- `check_url_generic`: for each attempt, resolve `host` via `urllib.parse.urlsplit(url).hostname or url`; `async with _host_semaphore(host):` fetch. On DNS curl code (6), try the next `_router.candidates_for(host)` DoH URL before counting the attempt as failed; on success call `_router.reward(doh_url)` and on DNS failure `_router.penalize(doh_url)`. After a snapshot, if `is_retryable_status(code)` and attempts remain, sleep `max(_retry_after_seconds(headers) or 0, RETRY_BACKOFF_SECONDS * 2 ** (attempt - 1)) + random.uniform(0, 0.25)` and retry. On exception, retry only when `is_retryable(e)` and attempts remain, else `classify_exception`. Keep the `UrlCheck` assembly identical.
- `check_all_generic`: unchanged global semaphore; keep signature.

- [ ] **Step 5: Update `test_classify.py`**

Change the PEP723 deps to `["beautifulsoup4[lxml]", "publicsuffixlist", "yarl", "curl_cffi"]`. Replace the aiohttp-based exception fixtures with curl-code fakes: an object with `.code = 6` → `DNS_ERROR`; `.code = 28` → `ERROR`/`Timeout`; `.code = 60` → `ERROR`/`SSL Error`; `.code = 47` → `WARNING`/`Redirect Loop` (Review Focus 3); and a plain `Exception` → `ERROR`. Add a `classify_response` case with `content_type=""` and `html=None` asserting `ok` with a `Binary` subcategory (Review Focus 4).

- [ ] **Step 6: Update the two check scripts**

In `check_extensions.py` and `check_issues.py`: remove `import aiohttp`; replace `create_connector, generate_headers` with `create_session, USER_AGENT_LABEL`; change `async with aiohttp.ClientSession(timeout=..., headers=headers, connector=create_connector()) as session:` to `async with create_session() as session:`; change `fetch_sources`' session to `async with create_session() as session:`; drop the `seed`/`headers = generate_headers(seed)` lines; set the JSON `"user_agent"` field to `USER_AGENT_LABEL`. Update PEP723 deps to `["anyio", "beautifulsoup4[lxml]", "betterproto==2.0.0b7", "curl_cffi", "publicsuffixlist", "yarl"]`.

- [ ] **Step 7: Run the checks**

Run: `cd /home/mbrx/Coding/tool/keiyoushi-status && uvx ruff check .github/scripts/ && python3 .github/scripts/test_dns.py && uv run .github/scripts/test_classify.py && uv run .github/scripts/test_transport.py`
Expected: ruff `All checks passed!`, then `dns selftest OK`, `OK: ... classification ... cases passed`, `transport selftest OK`.

- [ ] **Step 8: Add transport self-check to CI**

In `.github/workflows/status.yaml` selfcheck job, after the DNS step, add:

```yaml
      - name: Run transport self-checks
        run: .github/scripts/test_transport.py
```

- [ ] **Step 9: Local smoke against real sites**

Run: `cd /home/mbrx/Coding/tool/keiyoushi-status && PYTHONPATH=.github/scripts uv run --with curl_cffi python3 -c "import asyncio, transport; ..."` fetching 3 URLs (one Cloudflare-fronted, one plain) and asserting `resp.http_version == CurlHttpVersion.V2_0`. This is a manual sanity check, not a committed test.

- [ ] **Step 10: Commit**

```bash
git add .github/scripts/transport.py .github/scripts/classify.py .github/scripts/test_classify.py .github/scripts/test_transport.py .github/scripts/check_extensions.py .github/scripts/check_issues.py .github/workflows/status.yaml
git commit -m "feat(scripts): fetch via curl_cffi browser impersonation with per-TLD DoH

Swap aiohttp for curl_cffi AsyncSession (chrome TLS/JA3 + HTTP/2), feed the
per-TLD DoH router into each request's doh_url, retry 5xx/429 with Retry-After
and jitter, cap concurrency per host. Remap classify_exception to curl codes.
Drops aiohttp/aia/dnspython/httpx/ua-generator."
```

---

### Task 3: Quantitative A/B verification

**Files:**
- Modify: `TODO.md` (record the measured result)

**Interfaces:**
- Consumes: the running pipeline from Task 2.
- Produces: a documented before/after metric. No code.

- [ ] **Step 1: Freeze the baseline**

Before re-scraping, save the current `web/data/extensions.json` (the 455/1530 = 29.7% challenge baseline) to `/tmp/opencode/baseline-extensions.json`.

- [ ] **Step 2: Run the new pipeline on the same source set**

Trigger the workflow with `mode=scrape_only` (or run `check_extensions.py` locally against `build/sources.json`), so the URL set is identical.

- [ ] **Step 3: Compare**

Compute `iuam + blocked + waf` share before vs after, and `dns_error` before vs after. Success: challenge share drops significantly; `dns_error` does not worsen.

- [ ] **Step 4: Spot-check false-oks**

Sample 20 sources that changed to `ok`; open each in a browser and confirm it is genuinely reachable. Any false-`ok` means the impersonation is fooling the classifier, not the site — stop and investigate.

- [ ] **Step 5: Confirm the guard**

Run `.github/scripts/guard_regression.py` against the new data; it must pass.

- [ ] **Step 6: Record and commit**

Add a `### HTTP transport A/B (2026-10-03)` note under the Round 4 section of `TODO.md` with the before/after numbers and the spot-check outcome.

```bash
git add TODO.md
git commit -m "docs(todo): record curl_cffi transport A/B result"
```

---

### Task 4 (conditional): Targeted AIA/CA fallback

**Trigger:** Task 3 shows specific sources regressed from a working state to `error`/`SSL Error` because libcurl could not complete an incomplete certificate chain.

**Files:**
- Modify: `.github/scripts/transport.py`

**Interfaces:**
- Consumes: `_fetch_snapshot`, `classify_exception`.
- Produces: on an SSL curl code (35/60), retry once with a CA-completing context if a viable mechanism exists.

- [ ] **Step 1:** Identify the regressed hosts from the Task 3 diff and confirm the cause is an incomplete chain (not a real outage) with `openssl s_client -connect host:443 -showcerts`.
- [ ] **Step 2:** Write a failing fixture in `test_classify.py` or `test_transport.py` that pins the intended retry behavior for an SSL curl code.
- [ ] **Step 3:** Implement the minimal fallback in `_fetch_snapshot` (e.g. a curated CA bundle for the affected hosts, or skip if no clean mechanism exists and document why).
- [ ] **Step 4:** Run ruff + all self-checks; commit.

If Task 3 shows no such regression, record "not needed" in `TODO.md` and do not implement.
