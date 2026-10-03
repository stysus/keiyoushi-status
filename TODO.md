# Optimization Plan — Verifikasi & Hasil Verifikasi

Kerja bertahap. Centang saat selesai. `[ ]` belum, `[x]` selesai.

## Stage 1 — Fondasi: refactor + enrich schema (P0 #2 + P1 #4) ✅

- [x] Pecah `check_url_generic` menjadi: `_fetch_snapshot` (I/O) + `classify_response` (murni, bisa dites)
- [x] `UrlCheck` membawa `http_code`, `final_url`, `attempts`
- [x] Update `check_extensions.py`: `CheckResult` + output JSON (`http_code`, `final_url`, `attempts`)
- [x] Update `check_issues.py`: idem
- [x] Perilaku klasifikasi identik dengan sebelumnya (regresi nol)

## Stage 2 — Retry transien (P0 #1) ✅

- [x] Retry network-level error (timeout / koneksi / DNS) sekali dengan backoff
- [x] Jangan retry error deterministik (SSL cert, 4xx/5xx nyata, too-many-redirects)

## Stage 3 — Fix false-positive SPA (P0 #3) ✅

- [x] Deteksi marker SPA sebelum menandai `Blank Page`

## Stage 4 — Tes klasifikasi (P1 #4) ✅

- [x] `test_classify.py` dengan fixture HTML, `assert`-based, jalan via `uv run`
- [x] Lolos ruff (15 klasifikasi + 3 exception + 4 retry)

## Stage 5 — Guard regresi verifier (P1 #5) ✅

- [x] Bandingkan hasil baru vs `extensions.json` lama; gagalkan bila ada kategori anomali
- [x] `guard_regression.py` + selftest + wired ke workflow

## Stage 6 — Fix tier hero (P2 #7) ✅

- [x] `getTierCategory`: redirect beda otoritas tidak dihitung operational

## Backlog P2

### Stage 7 — #12 Logging ringkasan per shard ✅
- [x] Ringkasan `Counter(status)` di `check_extensions.py`, `check_issues.py`, dan `merge_shards`

### Stage 8 — #8 Riwayat / trend harian ✅
- [x] `record_history.py`: hitung tier dari `extensions.json`, append/replace entri harian ke `web/data/history.json` (cap 90 hari)
- [x] Wire ke workflow sebelum commit
- [x] `history.json` ikut ter-commit (`web/data/*.json`)

### Stage 9 — Frontend: trend + enrich ✅
- [x] Sparkline trend operational di hero (dari `history.json`)
- [x] Surface `http_code` / `final_url` (tooltip + kolom CSV)

### Ditolak (terukur, tidak dikerjakan)
- ~~#9 Dedup source berdasarkan URL~~ — hanya 17/1530 cek duplikat (1,1%), dan itu entri berbeda yang berbagi home URL → menghapus baris tampilan.
- ~~#10 Lazy-init klien DNS~~ — ~40 objek klien/resolver, biaya startup & memori dapat diabaikan.
- ~~#11 Unduh `index.pb` sekali~~ — `index.pb` cuma 108KB; 16 shard ≈ 1,7MB, plumbing artefak tak sepadan.
- ~~#6 `subcategory` jadi enum~~ — YAGNI: tak ada konsumen yang mengagregasi subcategory; UI memfilter per status. Tawarkan bila diminta.

---

## Round 2 — Bug + completion (bukti terverifikasi)

### Stage 10 — 🔴 Bug: deteksi redirect pakai authority, bukan prefix string ✅
- [x] `redirected = URL(final_url) != URL(original_url)` (bukan `str.startswith`)
- [x] Fixture tes: lookalike (`x.test.evil.test`), same-path redirect, trailing-slash
- [x] Replay data nyata: 48 baris flag berubah (semua redirect path same-authority, tier-neutral)

### Stage 11 — 🔴 Bug: romanisasi Hangul di `map_bug_issues.py` ⬜
- [ ] Perluas `CJK_RE` dengan blok Hangul (`\uac00-\ud7af`)
- [ ] Jalur romanisasi Korea + dep `korean-romanizer`
- [ ] Selftest fixture: `늑대닷컴` dapat slug

### Stage 12 — #4 Backfill `history.json` dari git history ⬜
- [ ] Script sekali-jalan: baca tiap versi `web/data/extensions.json` dari `git log`, hitung tier, seed history
- [ ] Jalankan & commit hasil backfill (sparkline langsung tampil)

### Stage 13 — #5 Tes jalan di semua push ⬜
- [ ] Pindahkan/duplikasi `test_classify.py` ke job `detect` (selalu jalan) atau job kecil terpisah

### Stage 14 — #3 Race sharding: unduh `index.pb` sekali ⬜
- [ ] `detect` simpan sources ke artefak; shard baca artefak (bukan fetch ulang) → hilangkan risiko source kelewatan

### Stage 15 — #6 Filter `http_code` + tampilkan `attempts` di UI ⬜
- [ ] Chip/kolom kode HTTP, indikator retry

### Stage 16 — Tes `map_bug_issues.py` ⬜
- [ ] Fixture body issue → assert match (logika paling kompleks, nol tes)

### Stage 17 — Hardening kecil ⬜
- [ ] CSV formula injection guard (`export.js`)
- [ ] a11y: `aria-sort`, `aria-pressed`, `<th scope>`

### Stage 18 — #7 Guard baseline lebih tahan banting ⬜
- [ ] Bandingkan vs median beberapa hari (opsional)

### UX opsional (tanya dulu)
- [ ] Auto-refresh + indikator umur data
- [ ] Deep-link state ke URL (`?tab=&q=&status=`)

### Skip
- ~~Virtualisasi tabel~~ — 1530 baris lancar.
- ~~Per-source uptime history~~ — file besar, belum ada kebutuhan.
