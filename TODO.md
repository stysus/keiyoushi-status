# Optimization Plan — Verifikasi & Hasil Verifikasi

Kerja bertahap. Centang saat selesai. `[ ]` belum, `[x]` selesai.

## Stage 1 — Fondasi: refactor + enrich schema (P0 #2 + P1 #4) [done]

- [x] Pecah `check_url_generic` menjadi: `_fetch_snapshot` (I/O) + `classify_response` (murni, bisa dites)
- [x] `UrlCheck` membawa `http_code`, `final_url`, `attempts`
- [x] Update `check_extensions.py`: `CheckResult` + output JSON (`http_code`, `final_url`, `attempts`)
- [x] Update `check_issues.py`: idem
- [x] Perilaku klasifikasi identik dengan sebelumnya (regresi nol)

## Stage 2 — Retry transien (P0 #1) [done]

- [x] Retry network-level error (timeout / koneksi / DNS) sekali dengan backoff
- [x] Jangan retry error deterministik (SSL cert, 4xx/5xx nyata, too-many-redirects)

## Stage 3 — Fix false-positive SPA (P0 #3) [done]

- [x] Deteksi marker SPA sebelum menandai `Blank Page`

## Stage 4 — Tes klasifikasi (P1 #4) [done]

- [x] `test_classify.py` dengan fixture HTML, `assert`-based, jalan via `uv run`
- [x] Lolos ruff (15 klasifikasi + 3 exception + 4 retry)

## Stage 5 — Guard regresi verifier (P1 #5) [done]

- [x] Bandingkan hasil baru vs `extensions.json` lama; gagalkan bila ada kategori anomali
- [x] `guard_regression.py` + selftest + wired ke workflow

## Stage 6 — Fix tier hero (P2 #7) [done]

- [x] `getTierCategory`: redirect beda otoritas tidak dihitung operational

## Backlog P2

### Stage 7 — #12 Logging ringkasan per shard [done]
- [x] Ringkasan `Counter(status)` di `check_extensions.py`, `check_issues.py`, dan `merge_shards`

### Stage 8 — #8 Riwayat / trend harian [done]
- [x] `record_history.py`: hitung tier dari `extensions.json`, append/replace entri harian ke `web/data/history.json` (cap 90 hari)
- [x] Wire ke workflow sebelum commit
- [x] `history.json` ikut ter-commit (`web/data/*.json`)

### Stage 9 — Frontend: trend + enrich [done]
- [x] Sparkline trend operational di hero (dari `history.json`)
- [x] Surface `http_code` / `final_url` (tooltip + kolom CSV)

### Ditolak (terukur, tidak dikerjakan)
- ~~#9 Dedup source berdasarkan URL~~ — hanya 17/1530 cek duplikat (1,1%), dan itu entri berbeda yang berbagi home URL → menghapus baris tampilan.
- ~~#10 Lazy-init klien DNS~~ — ~40 objek klien/resolver, biaya startup & memori dapat diabaikan.
- ~~#11 Unduh `index.pb` sekali~~ — `index.pb` cuma 108KB; 16 shard ≈ 1,7MB, plumbing artefak tak sepadan.
- ~~#6 `subcategory` jadi enum~~ — YAGNI: tak ada konsumen yang mengagregasi subcategory; UI memfilter per status. Tawarkan bila diminta.

---

## Round 2 — Bug + completion (bukti terverifikasi)

### Stage 10 — Bug: deteksi redirect pakai authority, bukan prefix string [done]
- [x] `redirected = URL(final_url) != URL(original_url)` (bukan `str.startswith`)
- [x] Fixture tes: lookalike (`x.test.evil.test`), same-path redirect, trailing-slash
- [x] Replay data nyata: 48 baris flag berubah (semua redirect path same-authority, tier-neutral)

### Stage 11 — Bug: romanisasi Hangul di `map_bug_issues.py` [done]
- [x] Perluas `CJK_RE` dengan blok Hangul (`\uac00-\ud7af\u3130-\u318f`) + `HANGUL_RE`
- [x] Jalur romanisasi Korea + dep `korean-romanizer`
- [x] Terverifikasi: `늑대닷컴 - 만화책` → `neukdaedatkeom - manhwachaek`, match skor 100

### Stage 12 — #4 Backfill `history.json` dari git history [done]
- [x] `backfill_history.py`: baca tiap versi `web/data/extensions.json` dari `git log`, hitung tier, seed history (entry live menang per tanggal)
- [x] Backfill 11 hari (2026-09-23 .. 2026-10-03); sparkline terverifikasi render

### Stage 13 — #5 Tes jalan di semua push [done]
- [x] Job `selfcheck` terpisah (selalu jalan, tak tergantung `should_scrape`)
- [x] `process` butuh `selfcheck` + guard `needs.selfcheck.result` → deploy terblokir bila tes gagal

### Stage 14 — #3 Race sharding: sumber dibekukan sekali [done]
- [x] `check_extensions.py --dump-sources` + `SOURCES_FILE` env; `detect` unduh sekali, upload artefak
- [x] Shard unduh artefak & baca daftar sumber yang sama (bukan fetch ulang) → tak ada sumber kelewatan
- [x] Terverifikasi: dump 1530 sumber; jalur cache offline `--get-shards` OK

### Stage 15 — #6 Filter `http_code` + tampilkan `attempts` di UI [done]
- [x] Pencarian cocokkan `http_code` (extensions + issues) → ketik "403" menyaring kode itu
- [x] Indikator `↻N` di kolom latency + `retried ×N` di tooltip bila `attempts > 1`
- [x] Chip khusus kode HTTP di-skip: kotak pencarian sudah menutupi (53 baris retry, 449 baris 403 terlihat)

### Stage 16 — Tes `map_bug_issues.py` [done]
- [x] `test_map_bug_issues.py`: 7 kasus (romanisasi, extract source, title split, match URL/exact/Hangul, superset suppression, parse JSON)
- [x] Lolos ruff; dijalankan di job `selfcheck` (semua push)

### Stage 17 — Hardening kecil [done]
- [x] CSV formula injection guard (`export.js`): sel berawalan `= + - @ \t \r` diberi prefix `'`
- [x] a11y: `aria-sort` dinamis, `scope="col"` pada semua `<th>`, `aria-pressed` pada chip filter
- [x] Terverifikasi via node: guard netralkan `=cmd()`/`-42`, nama wajar utuh; atribut a11y muncul

### Stage 18 — #7 Guard baseline lebih tahan banting [done]
- [x] Baseline operational = **median 7 hari terakhir** dari `history.json` (fallback ke hari sebelumnya bila <3 hari)
- [x] Selftest: hari baseline yang sudah rusak tak lagi menyembunyikan collapse nyata; recovery wajar tak memicu alarm
- [x] Terverifikasi: median op share 0.8311, guard lolos pada data 1530 baris

### UX opsional
- [x] Deep-link state ke URL (`?tab=&q=&status=`) — seed saat init, tulis via `replaceState` (debounced); terverifikasi di browser (lokal + live)

### Perbaikan pipeline (ditemukan saat verifikasi deploy)
- [x] `deploy` di-skip pada push web-only / mode `deploy_only`: skip dari job `scrape-*` merambat karena `if` deploy tanpa fungsi status. Diperbaiki dengan `!cancelled() && needs.process.result == 'success'`. Terverifikasi di kedua mode.

### Skip
- ~~Virtualisasi tabel~~ — 1530 baris lancar.
- ~~Per-source uptime history~~ — file besar, belum ada kebutuhan.
- ~~Auto-refresh + indikator umur data~~ — data berubah ~1×/hari; user memutuskan tidak perlu.

---

## Round 3 — Decouple status dari emoji (Opsi B)

Data/key jadi slug ASCII stabil; emoji hanya glyph tampilan di `STATUS_CONFIG`.

Peta slug: `ok, redirect, iuam, waf, blocked, rate_limited, dns_error, parked, placeholder, warning, error, not_found`.

### Stage 19 — Producer Python: `Status` pakai slug [done]
- [x] `common.py` `Status(StrEnum)` value → slug (nama enum tetap)
- [x] `test_classify.py` tetap lolos (pakai `Status.X`, bukan literal)

### Stage 20 — Konsumen Python [done]
- [x] `map_bug_issues.py`: field `emoji` → `status`; output `"status": m.entry.status`
- [x] `guard_regression.py`: `OPERATIONAL_STATUSES` + literal → slug
- [x] `record_history.py`: set/literal → slug
- [x] `test_map_bug_issues.py`: fixture → slug
- [x] `backfill_history.py`: terjemahkan emoji historis → slug saat replay git (pakai escape, file tetap bebas emoji)

### Stage 21 — Konsumen JS [done]
- [x] `config.js`: `STATUS_CONFIG` key slug + field `emoji` (glyph) + label/warna; cek status → slug
- [x] `state.js`: `STATUS_RANK` + filter map → slug
- [x] `components.js`: `renderStatusPill`/`renderStatusCell`/chip → slug; pill menampilkan `conf.emoji`
- [x] `table.js`: `renderStatusPill('not_found')`

### Stage 22 — Migrasi data + docs [done]
- [x] Tulis ulang `web/data/{extensions,issues,issue_map}.json`: nilai `status` emoji → slug (2051 field)
- [x] `README.md` contoh JSON → slug; emoji dekoratif dihapus
- [x] `?status=` deep-link lama (emoji) tak didukung lagi (minor, `readStateFromUrl` abaikan)

### Stage 23 — Verifikasi [todo]
- [ ] Semua selftest + ruff + `node --check`
- [ ] Guard lolos pada data ter-migrasi
- [ ] Browser lokal: pill/emoji, chip, filter, deep-link slug
- [ ] Live setelah deploy
