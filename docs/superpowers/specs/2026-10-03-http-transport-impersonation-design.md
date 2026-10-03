# HTTP Transport Upgrade: Browser Impersonation (curl_cffi)

Date: 2026-10-03
Status: Approved for planning

## Problem

The scrape pipeline's HTTP capability is the weakest link in result validity.
~30% of the 1530 checked rows land in `iuam` (385) + `blocked` (50) + `waf` (20)
= 455 rows (29.7%). These are sites that challenge or block the scraper, not
sites that are down for real users. The current client (`aiohttp`, HTTP/1.1
only, default OpenSSL TLS) presents a non-browser fingerprint, which is the
primary trigger for Cloudflare/Akamai challenges.

Secondary gaps: retries only cover network errors (5xx/429/403 are not retried),
no per-host concurrency limit, no jitter, `Retry-After` ignored, and no proxy
path when the GitHub Actions datacenter IP is itself the reason for a challenge.

## Goal

Replace the HTTP fetch layer with a browser-impersonating client so that
challenge/block classifications reflect real site availability more often,
without regressing the classification, history, or guard contracts.

## Success Criteria (quantitative, real data)

1. Primary: `iuam + blocked + waf` share drops significantly from the frozen
   baseline (455/1530 = 29.7%) when the same source set is re-checked.
2. Guard metric: `dns_error` does not worsen.
3. `ok` is not inflated by false-positives: spot-check N=20 newly-`ok` sources
   manually.
4. `guard_regression.py` still passes (operational share does not collapse or
   raise a false alarm).
5. Mechanism check: JA3/HTTP2 fingerprint matches Chrome via
   `tls.browserleaks.com` and `bot.sannysoft`.

## Non-Goals

- No change to the tier taxonomy (`tiers.py`) or `Tier` semantics.
- No change to the JSON schema (`extensions.json` / `issues.json` /
  `history.json`) or to `web/js`.
- No paid proxy assumed; proxy is an optional env knob only.
- No content-verification features (soft-404 etc.) in this change.

## Decision

Approach 1 (chosen): swap the fetcher to `curl_cffi` and feed the existing
per-TLD DoH routing into curl's per-request `doh_url`. This preserves the
censorship-aware DNS routing while removing the aiohttp/dnspython stack.

Alternatives rejected:
- Approach 2 (single global `doh_url`): loses RU/ZH/JP nameserver routing,
  risks a `dns_error` regression.
- Approach 3 (hybrid, `CURLOPT_RESOLVE`): keeps two HTTP stacks and all old
  plus new dependencies; most to maintain. Also, per-request `curl_options` is
  not supported by `AsyncSession` (verified), so this is not clean anyway.

## Architecture

### `dns.py` (new, stdlib-only)

Replaces `DNSPythonResolver`, `_DoHTCPConnector`, `_PersistentDoHNameserver`,
and `_NameserverScore`. Pure logic, no I/O:

- Nameserver pools: global, RU, ZH, JP (URLs carried over verbatim).
- TLD routing: `.ru/.su/.by/.kz` → RU primary; `.cn/.top/.wang/.xin/.site` → ZH
  primary; `.jp` → JP primary; else global; with fallback ordering.
- Weighted selection with reward/penalize scores (carried over).
- Interface: `candidates_for(host) -> list[str]` — ordered DoH URLs, primary
  first then fallbacks. A score object exposes `reward()` / `penalize()`.

### `transport.py`

- Client: `curl_cffi.AsyncSession(impersonate="chrome", http_version="v2",
  max_clients=MAX_CONCURRENT)`.
- `_fetch_snapshot` issues `session.get(url, doh_url=<candidate>, proxy=<env>)`
  and returns the same `_ResponseSnapshot` shape.
- Retry loop with jitter and `Retry-After`; per-host semaphore.
- Keeps `UrlCheck`, `check_url_generic`, `check_all_generic`, `record`,
  `format_duration`.
- aiohttp removed entirely, including `fetch_sources` (index.pb fetch).

### `classify.py`

- `classify_response` unchanged.
- `classify_exception` remapped to `curl_cffi` (`RequestsError` / `CurlError.code`):
  code 6 → `DNS_ERROR`; 28 → timeout `ERROR`; 35/60 → SSL `ERROR`;
  47 → redirect-loop `WARNING`; else `ERROR`.

### Callers

`check_extensions.py` / `check_issues.py` change `create_connector()` →
`create_session()`; flow and `record()` unchanged. `tiers.py`,
`guard_regression.py`, `record_history.py` unchanged.

## Retry / Rate-limit / Concurrency

- Retry (transient): curl network codes (6/7/28/52/56), HTTP 5xx, HTTP 429.
  Max 3 attempts; backoff `0.5s * 2^(n-1)` plus jitter.
- `Retry-After` honored on 429/503 when reasonable (capped at 5s).
- No retry (deterministic): 403/challenge (iuam/blocked/waf), SSL cert (60),
  other 4xx. Impersonation, not retry, is the remedy here.
- DNS failover: a DNS error tries the next DoH candidate before giving up.
- Concurrency: global `max_clients=80`; per-host limit 3.

## Proxy

`curl_cffi` reads `HTTP_PROXY` / `HTTPS_PROXY` from the environment. CI may set
a proxy secret if the datacenter IP stays suspect; otherwise behavior is
unchanged. No paid proxy is assumed.

## Dependency Delta (PEP723)

- Add: `curl_cffi`.
- Remove: `aiohttp[speedups]`, `aia`, `dnspython[doh,idna]`, `httpx[http2]`,
  `ua-generator`.
- Keep: `beautifulsoup4[lxml]`, `publicsuffixlist`, `yarl`, `betterproto`,
  `anyio`.

## Phased Plan (separate commits, CI green between phases)

1. `dns.py` + `test_dns.py` (pure). No behavior change.
2. Transport swap: `transport.py` on `curl_cffi`; expanded retry; per-host
   limit; per-request `doh_url`; proxy. `classify_exception` remap +
   `test_classify.py` update. Callers switch to `create_session()`. Remove the
   aiohttp DNS classes. Update PEP723 lists. (Risk phase — A/B here.)
3. Quantitative verification + guard. Run `scrape_only`, compare the
   challenge share to 29.7%, spot-check 20 newly-`ok`, confirm guard passes.
   Record results in this spec/plan (durable) and the local SDD ledger.
4. Conditional: targeted AIA/CA fallback only if a specific cert-chain
   regression appears.

## Testing

- `test_dns.py`: TLD routing, failover order, weighting. No network.
- `test_classify.py`: `classify_exception` fixtures for curl codes (6/28/60/47).
- Local smoke: fetch several URLs including Cloudflare-fronted ones; assert
  `http_version` is h2.
- Production A/B: quantitative metrics in phase 3.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| AIA fallback removed | Some cert-chain sites → `error` | Measure in phase 3; targeted fallback in phase 4 |
| Datacenter IP still challenged | Challenge share does not drop fully | Optional proxy env |
| Per-request `doh_url` forces new connections | Slower run | Measure duration; `max_clients` + failover |
| Native dependency on runner | Install failure | curl_cffi prebuilt wheels; verify in CI |

## Rollback

All changes live in `transport.py` + `dns.py` + `classify_exception`. Reverting
one commit restores the old behavior. Pre-change baseline JSON is kept as a CI
artifact.

## Open Questions

- Whether to surface `http_version`/`impersonate` in the record (deferred; log
  only for now to keep the data schema and `web/js` untouched).
- Whether a proxy secret will actually be configured (decision deferred to the
  phase-3 measurement).
