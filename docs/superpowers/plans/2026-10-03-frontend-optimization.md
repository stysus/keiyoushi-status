# Frontend Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Tailwind Play CDN with a prebuilt static stylesheet, remove the theme flash, harden the UX, fix the accessibility gaps, and split the overloaded `app.js` — without changing the data pipeline or JSON schema.

**Architecture:** A build-time Tailwind CLI step in the `process` CI job compiles `web/css/input.css` into a gitignored `web/css/app.css` before the Pages artifact is uploaded. The deployed `web/` directory stays static; the only new dependency is a build-time dev dependency. Runtime behavior, module layout, and the data contract are preserved.

**Tech Stack:** Tailwind CSS 3.4.19 (CLI), plain ES modules, `node --test`, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-03-frontend-optimization-design.md`

## Global Constraints

- No new **runtime** dependency. Only `tailwindcss` as a build-time dev dependency (pinned `3.4.19`).
- Do not change the JSON schema or commit `web/data/*.json` (CI auto-commits those).
- `web/js` pure logic must keep `node --test 'tests/**/*.test.mjs'` green; ruff and the Python self-checks are unaffected.
- Preserve the existing visual identity. Verify with a visual diff of all three tabs in both themes.
- One phase = one logical commit; CI green between phases. `web/**` (or the workflow) must be part of a commit for CI to trigger.
- `web/css/app.css` is generated in CI and gitignored; never commit it.
- Node 22 in CI (`actions/setup-node`); `npm ci` from the committed lockfile.

## Review Focus

These are the failure modes most likely to bite, one line each. Each is pinned by a test in the named task.

1. A Tailwind class that appears **only inside a JS string** is missed by the `content` scan and silently loses its style — pinned by the CI build assertion in Task 1.
2. A light-mode user (stored preference or OS setting) sees a **dark flash** before first paint — pinned by the `index.html` contract test in Task 2.
3. Filtering/searching drops the row count below `currentPage`, producing a **blank table body** while pagination still shows a valid page — pinned by the `computePageSlice` test in Task 5.
4. A keyboard user on a sortable header gets **no action** because the `<th>` is click-only — pinned by the `renderTableHead` test in Task 4.
5. Arrow-key tab navigation runs off the **end** (or start) instead of wrapping — pinned by the `nextTabIndex` test in Task 4.

---

### Task 1: Tailwind static build

**Files:**
- Create: `tailwind.config.js`
- Create: `web/css/input.css`
- Create: `package-lock.json` (generated, committed)
- Modify: `package.json`
- Modify: `web/index.html` (head only)
- Modify: `.gitignore`
- Modify: `.github/workflows/status.yaml` (`process` job)

**Interfaces:**
- Consumes: nothing.
- Produces: `web/css/app.css` (generated, gitignored), built by `npm run build:css`. Later tasks add `@font-face`/`@media` rules to `web/css/input.css`.

- [ ] **Step 1: Add the Tailwind dev dependency and scripts**

Replace the contents of `package.json` with:

```json
{
  "name": "keiyoushi-status",
  "private": true,
  "type": "module",
  "description": "Node config for the web-logic self-checks (node --test) and the Tailwind CSS build. No runtime deps.",
  "scripts": {
    "test": "node --test 'tests/**/*.test.mjs'",
    "build:css": "tailwindcss -i web/css/input.css -o web/css/app.css --minify"
  },
  "devDependencies": {
    "tailwindcss": "3.4.19"
  }
}
```

- [ ] **Step 2: Generate the lockfile**

Run: `npm install`
Expected: creates `package-lock.json` and `node_modules/`. Do not commit `node_modules/`.

- [ ] **Step 3: Create `tailwind.config.js`**

Move the inline Play-CDN config here. `package.json` is `type: module`, so the config is ESM:

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./web/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        zinc: {
          850: '#1f1f23',
          925: '#111114',
          950: '#09090b',
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Create `web/css/input.css`**

Copy the custom scrollbar rules verbatim from the inline `<style>` in `web/index.html`. Drop the custom `.tabular-nums` rule — Tailwind already emits `tabular-nums`, and the class is used in the markup so the scanner will generate it.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom sleek scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(161, 161, 170, 0.35);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(161, 161, 170, 0.55);
}
.dark ::-webkit-scrollbar-thumb {
  background: rgba(113, 113, 122, 0.45);
}
.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(113, 113, 122, 0.7);
}
```

- [ ] **Step 5: Swap `index.html` from CDN to the built stylesheet**

Delete the Play CDN `<script src="https://cdn.tailwindcss.com"></script>`, the inline `tailwind.config` `<script>` block, and the inline `<style>` block (lines 15–64). In their place, after the font links, add:

```html
  <link rel="stylesheet" href="css/app.css">
```

- [ ] **Step 6: Gitignore the build outputs**

Append to `.gitignore`:

```gitignore

### Node / web build ###
node_modules/
web/css/app.css
```

- [ ] **Step 7: Build locally and verify the scan caught JS-only classes**

Run:
```bash
npm run build:css
test -s web/css/app.css && echo "app.css non-empty"
! grep -q '@tailwind' web/css/app.css && echo "directives resolved"
for cls in bg-zinc-850 stroke-emerald-500 text-amber-800 bg-indigo-500; do
  grep -q -- "$cls" web/css/app.css && echo "found .$cls" || echo "MISSING .$cls"
done
```
Expected: `app.css non-empty`, `directives resolved`, and all four classes found. `bg-zinc-850` and `stroke-emerald-500` appear **only** in JS strings, so finding them proves the `web/**/*.js` scan works.

- [ ] **Step 8: Visual diff**

Serve and compare all three tabs in both themes against the live site (or the pre-change page):
```bash
python3 -m http.server 8000 --directory web
```
Expected: identical layout, spacing, and colors. If a style is missing, add the class to `content` (or a `safelist`) before proceeding.

- [ ] **Step 9: Add the CI build step**

In `.github/workflows/status.yaml`, in the `process` job, insert immediately before the `Setup Pages` step:

```yaml
      - name: Setup Node for Tailwind
        if: needs.detect.outputs.should_deploy == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Build Tailwind CSS
        if: needs.detect.outputs.should_deploy == 'true'
        run: |
          npm ci
          npm run build:css
          test -s web/css/app.css
          if grep -q '@tailwind' web/css/app.css; then
            echo "::error::Unresolved @tailwind directives in app.css"; exit 1
          fi
          for cls in bg-zinc-850 stroke-emerald-500 text-amber-800 bg-indigo-500; do
            grep -q -- "$cls" web/css/app.css || {
              echo "::error::Tailwind missed .$cls — check the content globs"; exit 1;
            }
          done
```

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tailwind.config.js web/css/input.css web/index.html .gitignore .github/workflows/status.yaml
git commit -m "perf(web): build Tailwind CSS statically instead of the Play CDN"
```

---

### Task 2: Theme no-flash + document meta

**Files:**
- Modify: `web/index.html`
- Test: `tests/web.test.mjs`

**Interfaces:**
- Consumes: Task 1's `index.html` head.
- Produces: nothing later tasks import. The `keiyoushi-theme` localStorage key stays the single source of truth, shared with `web/js/theme.js`.

- [ ] **Step 1: Write the failing test**

Add to `tests/web.test.mjs` (it already imports `readFileSync`):

```js
const indexHtml = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('index.html applies the stored theme before first paint', () => {
  // No hardcoded dark class: the inline bootstrap decides before paint.
  assert.doesNotMatch(indexHtml, /<html[^>]*class="dark"/);
  assert.match(indexHtml, /keiyoushi-theme/);
  // The bootstrap must run before the stylesheet link.
  const boot = indexHtml.indexOf('keiyoushi-theme');
  const css = indexHtml.indexOf('css/app.css');
  assert.ok(boot > -1 && css > -1 && boot < css, 'theme bootstrap must precede the stylesheet');
});

test('index.html declares canonical and share metadata', () => {
  assert.match(indexHtml, /rel="canonical"/);
  assert.match(indexHtml, /property="og:title"/);
  assert.match(indexHtml, /name="theme-color"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: FAIL — `index.html` still has `class="dark"` and no canonical/OG tags.

- [ ] **Step 3: Implement the head changes**

In `web/index.html`:

1. Change `<html lang="en" class="dark">` to `<html lang="en">`.
2. Add this blocking script immediately before the `<link rel="stylesheet" href="css/app.css">` (keep the same localStorage key as `web/js/theme.js`):

```html
  <script>
    // Keep in sync with web/js/theme.js. Must run before first paint.
    (function () {
      try {
        var saved = localStorage.getItem('keiyoushi-theme');
        var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('dark', dark);
      } catch (e) {}
    })();
  </script>
```

3. Add these meta tags in the `<head>` (after `<meta name="description">`):

```html
  <link rel="canonical" href="https://stysus.github.io/keiyoushi-status/">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Keiyoushi Status">
  <meta property="og:description" content="Operational health and tracking dashboard for the Keiyoushi extensions ecosystem.">
  <meta property="og:url" content="https://stysus.github.io/keiyoushi-status/">
  <meta name="twitter:card" content="summary">
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/index.html tests/web.test.mjs
git commit -m "fix(web): apply the stored theme before first paint; add share metadata"
```

---

### Task 3: UX — load-error state, noscript, reduced motion

**Files:**
- Modify: `web/index.html`
- Modify: `web/css/input.css`
- Modify: `web/js/state.js`
- Modify: `web/app.js`
- Test: `tests/web.test.mjs`

**Interfaces:**
- Consumes: Task 1's `web/css/input.css`.
- Produces: `loadData(tab)` now **rejects** on failure instead of resolving `null`. Callers are `renderActiveTab` and `updateTrend` in `web/app.js` (both updated in this task).

- [ ] **Step 1: Write the failing test**

Add to `tests/web.test.mjs`:

```js
test('index.html has a distinct load-error state and a noscript fallback', () => {
  assert.match(indexHtml, /id="errorState"/);
  assert.match(indexHtml, /id="retryLoadBtn"/);
  assert.match(indexHtml, /<noscript>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: FAIL — no `errorState`/`retryLoadBtn`/`<noscript>` yet.

- [ ] **Step 3: Make `loadData` reject on failure**

In `web/js/state.js`, change the `catch` in `loadData` to rethrow instead of returning `null`:

```js
  } catch (err) {
    console.error(`Failed to load ${tab} data:`, err);
    throw err;
  }
```

- [ ] **Step 4: Add the error state and noscript markup**

In `web/index.html`, after the `#emptyState` block, add:

```html
      <!-- Load Error State -->
      <div id="errorState" class="hidden p-16 text-center">
        <div class="inline-flex w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/40 items-center justify-center text-rose-600 dark:text-rose-400 mb-3">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
        </div>
        <p class="text-sm font-semibold text-zinc-950 dark:text-white">Could not load data</p>
        <p class="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-sm mx-auto">The dashboard data failed to load. Check your connection and try again.</p>
        <button id="retryLoadBtn" type="button" class="mt-4 px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors">
          Retry
        </button>
      </div>
```

Immediately after `<body ...>`, add:

```html
  <noscript>
    <div class="m-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-4 text-sm text-amber-900 dark:text-amber-200">
      This dashboard needs JavaScript to load and render its data.
    </div>
  </noscript>
```

- [ ] **Step 5: Wire the error state in `web/app.js`**

Add to the `el` cache: `errorState: document.getElementById('errorState')`, `retryLoadBtn: document.getElementById('retryLoadBtn')`.

In `renderActiveTab`, replace the `const data = await loadData(...)` + null check with:

```js
  let data;
  try {
    data = await loadData(state.activeTab);
  } catch (err) {
    el.loadingState.classList.add('hidden');
    el.tableWrapper.classList.add('hidden');
    el.emptyState.classList.add('hidden');
    el.errorState.classList.remove('hidden');
    return;
  }
  el.errorState.classList.add('hidden');
  el.loadingState.classList.add('hidden');
```

Also hide `el.errorState` in the "no results" and normal branches (add `el.errorState.classList.add('hidden')` alongside the existing `emptyState` toggles). In `updateTrend`, wrap the body in `try { ... } catch { return; }`.

In `setupEvents`, add a retry handler:

```js
  el.retryLoadBtn.addEventListener('click', () => {
    state.data[state.activeTab] = null;
    renderActiveTab();
  });
```

- [ ] **Step 6: Add the reduced-motion guard**

Append to `web/css/input.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 7: Run the tests and the build**

Run: `node --test 'tests/**/*.test.mjs' && npm run build:css`
Expected: PASS; `app.css` rebuilds.

- [ ] **Step 8: Manual check**

At 375 px width, confirm the header, hero, tabs, search, and table scroll without overlap. Confirm that blocking the data request (DevTools offline) shows the error state and Retry recovers.

- [ ] **Step 9: Commit**

```bash
git add web/index.html web/css/input.css web/js/state.js web/app.js tests/web.test.mjs
git commit -m "fix(web): distinguish load errors from empty results; add noscript and reduced-motion"
```

---

### Task 4: Accessibility — keyboard sort, tab ARIA, labels, live region

**Files:**
- Modify: `web/js/table.js`
- Modify: `web/js/utils.js`
- Modify: `web/app.js`
- Modify: `web/index.html`
- Test: `tests/web.test.mjs`

**Interfaces:**
- Consumes: `renderTableHead(activeTab, sortColumn, sortDirection)` (unchanged signature).
- Produces: `nextTabIndex(current, key, count) -> number` exported from `web/js/utils.js`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/web.test.mjs`:

```js
import { renderTableHead } from '../web/js/table.js';
import { nextTabIndex } from '../web/js/utils.js';

test('sortable headers expose a keyboard-reachable button', () => {
  const head = renderTableHead('extensions', null, 'asc');
  assert.match(head, /aria-sort="none"/);
  // Every th that declares data-sort must wrap its label in a button.
  for (const col of ['status', 'name', 'time']) {
    const re = new RegExp(`<th[^>]*data-sort="${col}"[^>]*>[\\s\\S]*?<button`);
    assert.match(head, re, `sortable column ${col} needs a button`);
  }
});

test('nextTabIndex wraps and handles Home/End', () => {
  assert.equal(nextTabIndex(0, 'ArrowLeft', 3), 2);
  assert.equal(nextTabIndex(2, 'ArrowRight', 3), 0);
  assert.equal(nextTabIndex(1, 'Home', 3), 0);
  assert.equal(nextTabIndex(1, 'End', 3), 2);
  assert.equal(nextTabIndex(1, 'Enter', 3), 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: FAIL — `nextTabIndex` is not exported and headers have no button.

- [ ] **Step 3: Add `nextTabIndex` to `web/js/utils.js`**

```js
/**
 * Returns the next tab index for arrow/Home/End navigation, wrapping at the ends.
 * @param {number} current
 * @param {string} key
 * @param {number} count
 * @returns {number}
 */
export function nextTabIndex(current, key, count) {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return current;
  }
}
```

- [ ] **Step 4: Wrap sortable header labels in buttons**

In `web/js/table.js`, for each sortable `<th>` in `renderTableHead`, keep `aria-sort` and `data-sort` on the `<th>`, remove `cursor-pointer` from the `<th>`, and wrap the label in a button, e.g. for STATUS:

```html
<th scope="col" aria-sort="${ariaSort('status', sortColumn, sortDirection)}" class="py-2.5 px-4 w-36" data-sort="status">
  <button type="button" class="w-full text-left font-semibold hover:text-zinc-950 dark:hover:text-white transition-colors cursor-pointer">
    STATUS ${getSortIndicator('status', sortColumn, sortDirection)}
  </button>
</th>
```

Apply the same to `name`/`time` (extensions), `number`/`time` (issues), and `number`/`source` (map). Use `text-right` on the LATENCY button to match the column alignment. Non-sortable `<th>` cells are unchanged.

- [ ] **Step 5: Add tab ARIA, labels, and the live region**

In `web/index.html`:

1. Tab buttons: add `role="tab"`, `id="tabExtensionsBtn"` (etc.), `aria-controls="tableWrapper"`, `aria-selected`, and `tabindex` to each `.tab-btn`. The first tab gets `aria-selected="true" tabindex="0"`, the others `aria-selected="false" tabindex="-1"`.
2. Give the table container `role="tabpanel"`: add `id="tableWrapper" role="tabpanel"` (it already has `id="tableWrapper"`).
3. Add accessible names:
```html
            <label for="searchInput" class="sr-only">Filter current view</label>
```
before the search `<input>`, and
```html
            <label for="pageSizeSelect" class="sr-only">Rows per page</label>
```
before the `<select>`.
4. Add `aria-live="polite"` to `<div id="paginationInfo">`.

- [ ] **Step 6: Sync ARIA and add arrow-key navigation in `web/app.js`**

In `applyTabStyles`, set `aria-selected` and `tabindex` alongside the class toggle:

```js
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    btn.tabIndex = isTarget ? 0 : -1;
```

In `setupEvents`, add a keydown listener on the tablist. Import `nextTabIndex` from `./js/utils.js`:

```js
  const tablist = el.tabBtns[0]?.parentElement;
  tablist?.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const btns = [...el.tabBtns];
    const idx = btns.indexOf(document.activeElement);
    if (idx < 0) return;
    e.preventDefault();
    const next = nextTabIndex(idx, e.key, btns.length);
    switchTab(btns[next].dataset.tab);
    btns[next].focus();
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: PASS.

- [ ] **Step 8: Manual keyboard check**

Tab to a sortable header, press Enter — it sorts once. Tab to the tablist, press ArrowRight/ArrowLeft — focus and the active tab move and wrap.

- [ ] **Step 9: Commit**

```bash
git add web/js/table.js web/js/utils.js web/app.js web/index.html tests/web.test.mjs
git commit -m "a11y(web): keyboard-sortable headers, tab ARIA with arrow nav, form labels, live region"
```

---

### Task 5: Code health — extract overview, pagination math, dedupe tab classes

**Files:**
- Create: `web/js/overview.js`
- Modify: `web/js/state.js`
- Modify: `web/app.js`
- Test: `tests/web.test.mjs`

**Interfaces:**
- Consumes: `state`, `loadData` from `web/js/state.js`; `getTierCategory` from `web/js/config.js`; `formatRelativeTime` from `web/js/utils.js`; `renderSparkline` from `web/js/components.js`.
- Produces: `computePageSlice(totalCount, pageSize, currentPage) -> { page, totalPages, size, start, end, isAll }` from `web/js/state.js`; `updateHeroOverview(el)`, `updateTabBadges(el)`, `updateTrend(el)` from `web/js/overview.js`.

- [ ] **Step 1: Write the failing test**

Add to `tests/web.test.mjs` (extend the existing `state` import):

```js
import { computePageSlice } from '../web/js/state.js';

test('computePageSlice clamps an out-of-range page instead of yielding an empty slice', () => {
  assert.deepEqual(computePageSlice(120, 50, 9), { page: 3, totalPages: 3, size: 50, start: 100, end: 120, isAll: false });
  assert.deepEqual(computePageSlice(0, 50, 1), { page: 1, totalPages: 1, size: 50, start: 0, end: 0, isAll: false });
  assert.deepEqual(computePageSlice(120, 'all', 1), { page: 1, totalPages: 1, size: 120, start: 0, end: 120, isAll: true });
  assert.deepEqual(computePageSlice(120, 50, 0), { page: 1, totalPages: 3, size: 50, start: 0, end: 50, isAll: false });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: FAIL — `computePageSlice` is not exported.

- [ ] **Step 3: Add `computePageSlice` to `web/js/state.js`**

```js
/**
 * Clamps the current page and computes the visible slice bounds.
 * @param {number} totalCount
 * @param {number|'all'} pageSize
 * @param {number} currentPage
 * @returns {{page:number, totalPages:number, size:number, start:number, end:number, isAll:boolean}}
 */
export function computePageSlice(totalCount, pageSize, currentPage) {
  const isAll = pageSize === 'all';
  const size = isAll ? totalCount : parseInt(pageSize, 10);
  const totalPages = isAll || totalCount === 0 ? 1 : Math.ceil(totalCount / size);
  const page = Math.min(Math.max(currentPage, 1), totalPages);
  const start = totalCount === 0 ? 0 : (page - 1) * size;
  const end = isAll ? totalCount : Math.min(page * size, totalCount);
  return { page, totalPages, size, start, end, isAll };
}
```

- [ ] **Step 4: Create `web/js/overview.js`**

Move `updateHeroOverview`, `updateTabBadges`, and `updateTrend` out of `web/app.js` verbatim, exporting them and importing their dependencies:

```js
import { getTierCategory } from './config.js';
import { formatRelativeTime } from './utils.js';
import { renderSparkline } from './components.js';
import { state, loadData } from './state.js';

export function updateHeroOverview(el) { /* moved body */ }
export function updateTabBadges(el) { /* moved body */ }
export async function updateTrend(el) { /* moved body */ }
```

The moved bodies read `el.statTotal` etc. exactly as before; only the `el` reference becomes the parameter.

- [ ] **Step 5: Use `computePageSlice` and the new module in `web/app.js`**

1. Delete the moved functions and import `{ updateHeroOverview, updateTabBadges, updateTrend } from './js/overview.js'`, and `computePageSlice` from `./js/state.js`.
2. Replace the pagination math in `renderActiveTab` and `renderPagination` with `computePageSlice`:

```js
  const { page, totalPages, size, start, end } = computePageSlice(filtered.length, state.pageSize, state.currentPage);
  state.currentPage = page;
  const pageItems = state.pageSize === 'all' ? filtered : filtered.slice(start, end);
  el.tableBody.innerHTML = renderTableRows(pageItems, state.activeTab);
  el.pageStart.textContent = (filtered.length === 0 ? 0 : start + 1).toLocaleString();
  el.pageEnd.textContent = end.toLocaleString();
  el.pageTotal.textContent = filtered.length.toLocaleString();
  el.paginationButtons.innerHTML = renderPaginationButtons(page, totalPages);
```

Remove the now-unused `renderPagination` function.

3. De-duplicate `applyTabStyles`: hoist the active/inactive class strings into two module-level constants (`const TAB_ACTIVE_CLASS = '...'; const TAB_INACTIVE_CLASS = '...';`) and apply them in the loop, keeping the `aria-selected`/`tabindex` updates from Task 4.

- [ ] **Step 6: Run the tests and the build**

Run: `node --test 'tests/**/*.test.mjs' && npm run build:css`
Expected: PASS; `app.css` rebuilds. Since `content` scans `web/**/*.js`, the new `overview.js` classes are picked up automatically.

- [ ] **Step 7: Visual + behavior check**

Reload all three tabs in both themes; paginate, filter to a single page, and confirm the footer counts and rows agree. Confirm the hero and 30-day trend still render.

- [ ] **Step 8: Commit**

```bash
git add web/js/overview.js web/js/state.js web/app.js tests/web.test.mjs
git commit -m "refactor(web): extract overview module and pagination math; dedupe tab classes"
```

---

## Self-Review

**Spec coverage:** Tailwind build → Task 1. Theme flash + meta → Task 2. UX (load-error, noscript, reduced-motion, mobile) → Task 3. A11y (sort headers, tabs, labels, live region) → Task 4. Code health (split `app.js`, dedupe classes, pagination fix) → Task 5. Fonts: **decided no change** — all four Inter weights (400/500/600/700) and all three JetBrains Mono weights (400/500/600) are used in the markup, so there is nothing to trim; self-hosting is a fragile subset-extraction exercise for a modest gain and is deliberately out of scope (recorded here as the spec's phase-2 decision). Row virtualization remains YAGNI.

**Type consistency:** `computePageSlice` returns `{ page, totalPages, size, start, end, isAll }` and is consumed only in `app.js`. `nextTabIndex(current, key, count)` matches its test. `overview.js` exports the three functions `app.js` imports.

**Placeholder scan:** no `TBD`/"handle edge cases" steps; every step names a file and a concrete change.

**Proportion:** five tasks, one per spec phase; code blocks are config values and test bodies the implementer cannot derive, not full implementations.
