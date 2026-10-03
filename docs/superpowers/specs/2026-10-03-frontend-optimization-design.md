# Frontend Optimization: Static CSS Build + UX/A11y/Code Health

Date: 2026-10-03
Status: Approved for planning

## Problem

The dashboard (`web/`) is served as a static site on GitHub Pages with **no build
step**. It loads Tailwind via the **Play CDN** (`cdn.tailwindcss.com`), which
compiles utilities in the browser at runtime. This is explicitly "not for
production": it adds a render-blocking ~300 KB JS payload, a JIT compile on the
main thread, and a flash of unstyled content.

Secondary issues found during the read-through:

1. **Theme FOUC** — `<html class="dark">` is hardcoded, but the real theme is
   only applied in `initTheme()` after the ES module graph loads. Light-preferring
   users see a dark flash on every load.
2. **Fonts** — two Google Fonts families / seven weights, loaded from a
   render-blocking external stylesheet behind two `preconnect`s.
3. **Accessibility gaps** — sortable `<th>` cells are click-only (no keyboard),
   tabs use `role="tablist"` without `role="tab"`/`aria-selected`, and the search
   input and page-size select have no associated `<label>`.
4. **Misleading empty state** — a failed `fetch` renders the same "no matching
   entries" message as a legitimate zero-result filter.
5. **`app.js` mixes concerns** (deferred "F" item from Round 4) — DOM cache,
   hero, trend, pagination, table render, tab styling, events, and bootstrap in
   one 420-line file.

## Goal

Reduce page-load cost and raise UX quality, accessibility, and code health of the
static dashboard without changing the data pipeline, the JSON schema, or the
`web/js` runtime behavior contract.

## Success Criteria

1. **Primary (measurable):** Tailwind is served as a prebuilt, minified static
   stylesheet. The Play CDN script, the inline `tailwind.config`, and the inline
   `<style>` are gone from `index.html`. A visual diff of all three tabs in both
   themes matches the current site.
2. **Theme:** no dark flash for light-mode users on first paint (stored theme
   applied before paint).
3. **A11y:** sortable headers are keyboard-operable; tabs expose
   `role="tab"`/`aria-selected` and support arrow-key navigation; search and
   page-size have accessible names.
4. **No regressions:** `node --test` stays green; ruff and all self-checks stay
   green; JSON schema and `web/data/*.json` untouched; CI green between phases.
5. **Deps:** no new **runtime** dependency. Only a build-time dev dependency
   (Tailwind CLI) is added.

## Non-Goals

- No change to the JSON schema (`extensions.json` / `issues.json` /
  `issue_map.json` / `history.json`) or to the scraping pipeline.
- No framework/bundler adoption (no Vite/Rollup/React). Plain ES modules stay.
- No row virtualization for the "All" page size (see Open Questions).
- No trimming of the JSON payloads.
- No design-language change: the existing visual identity is preserved.

## Decision

Add a **build-time** Tailwind step in CI and commit the source config, while the
deployed artifact stays a static `web/` directory.

Alternatives considered:

- **Precompile once and commit the CSS** — zero CI build, but drifts silently
  whenever a class is added in HTML/JS. Rejected: drift risk on a repo that
  regenerates classes from JS strings.
- **Replace Tailwind with hand-written semantic CSS** — zero build, but a large
  markup rewrite and loss of the utility vocabulary. Rejected: disproportionate.
- **Keep the CDN** — leaves the single largest load cost in place. Rejected.

## Architecture

### Build pipeline (CI)

Tailwind CLI runs in the `process` job, **before** `upload-pages-artifact`, so
the generated stylesheet is inside the `web/` artifact that Pages serves.

- `package.json`: add `tailwindcss` as a dev dependency; a lockfile is committed
  and `npm ci` is used in CI for reproducibility.
- `tailwind.config.js` (new, repo root): `darkMode: 'class'`, the `fontFamily`
  extension, the custom `zinc` shades (850/925/950), and
  `content: ['./web/**/*.{html,js}']`.
- `web/css/input.css` (new): `@tailwind base; @tailwind components;
  @tailwind utilities;` plus the custom scrollbar rules and `.tabular-nums`,
  moved verbatim out of the inline `<style>`.
- Output: `web/css/app.css` (minified), generated in CI and **gitignored**.

**Critical content-scanning constraint:** Tailwind class names live inside JS
string literals in `web/js/*.js` (`config.js`, `table.js`, `components.js`,
`app.js`). `content` MUST include `web/**/*.js`. The read-through confirmed all
class names are literal (no `'bg-' + x` construction), so scanning is
sufficient; a `safelist` is added only if the build diff reveals a missed class.

### `index.html`

- Remove the CDN `<script>`, the inline `tailwind.config` `<script>`, and the
  inline `<style>`.
- Add `<link rel="stylesheet" href="css/app.css">`.
- Add a tiny **blocking** inline script in `<head>` (before the stylesheet) that
  reads `localStorage` + `prefers-color-scheme` and sets the `dark` class on
  `<html>` before first paint. `initTheme()` keeps owning the toggle behavior;
  the hardcoded `class="dark"` is dropped.
- Add `theme-color`, Open Graph / Twitter card, and `canonical` meta tags.

### Fonts

Reduce to the weights actually used and keep `display=swap`. Self-hosting woff2
in `web/fonts/` (removing the two `preconnect`s and the external request) is the
preferred end state if the added repo weight is acceptable; otherwise trim
weights only. Decided at execution time and recorded in the plan.

### Accessibility

- Sortable `<th>`: wrap the label in a `<button>` so sorting is keyboard and
  screen-reader reachable; keep `aria-sort` on the `<th>`.
- Tabs: add `role="tab"`, `aria-selected`, `aria-controls`, roving `tabindex`,
  and ArrowLeft/ArrowRight navigation.
- `<label>` (visually hidden) for the search input and page-size select.
- An `aria-live="polite"` region for the result count.

### UX

- Distinguish a **load error** from an **empty filter result** in the empty
  state (different message, and a retry affordance if cheap).
- `<noscript>` fallback message.
- `prefers-reduced-motion` guard for the ping/transition animations.
- Mobile pass: horizontal-scroll affordance on the table, chip wrapping, hero
  layout.

### Code health

- Split `app.js`: extract hero/overview, trend, pagination, and table-render
  orchestration into modules; `app.js` becomes bootstrap/wiring only.
- Remove duplicated Tailwind class strings in `applyTabStyles` (constant map or a
  CSS `.is-active` class).
- Any new pure logic (e.g. theme resolution) gets one `node --test` test.

## Phased Plan (separate commits, CI green between phases)

1. **Tailwind build** — config, input.css, index.html swap, CI step, gitignore
   the output. Highest impact; verify with a visual diff of 3 tabs × 2 themes.
2. **Theme + meta** — inline no-flash theme script, meta tags, font trim/self-host.
3. **UX** — load-error vs empty state, `<noscript>`, reduced-motion, mobile pass.
4. **A11y** — keyboard-sortable headers, tab ARIA + arrow nav, form labels,
   live region.
5. **Code health** — split `app.js`, de-duplicate tab classes, add tests.

Phases 2–5 are independent of each other after phase 1 and can be reordered.

## Testing

- `node --test 'tests/**/*.test.mjs'` stays green; new pure logic gets a test.
- CI: `npm ci` + `npx tailwindcss … --minify` succeeds and the Pages artifact
  contains `web/css/app.css`.
- Manual visual diff (3 tabs × 2 themes) after the CSS swap.
- Lighthouse before/after recorded for phase 1.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A class only present in a JS string is not scanned | Missing style | `content` includes `web/**/*.js`; audit done; safelist if diff shows a gap |
| CDN vs CLI version drift | Minor visual differences | Pin Tailwind; visual diff all tabs/themes |
| CI build step fails / no Node | Deploy blocked | `actions/setup-node` with a pinned version; `npm ci` with committed lockfile |
| Self-hosted fonts bloat the repo | Larger checkout | Decide at execution; trim weights as the fallback |

## Rollback

Phase 1 is isolated to `index.html`, the new config/CSS files, and one CI step.
Reverting that commit restores the CDN. Later phases are independent commits.
The generated `web/css/app.css` is gitignored, so nothing stale is committed.

## Open Questions

- Fonts: self-host vs. trim weights (decide in phase 2 based on repo-size
  tolerance).
- "All" page size: leave as-is unless a real jank report appears (YAGNI).
- Whether to expose a build hash / cache-busting query on `app.css` (GitHub Pages
  sets its own caching; likely unnecessary).
