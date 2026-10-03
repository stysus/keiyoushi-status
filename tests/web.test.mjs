// Pure-logic self-checks for the web dashboard. No DOM/jsdom: only the
// functions that decide filtering, sorting, and tier display are exercised.
//
// Run: node --test 'tests/**/*.test.mjs'

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { STATUS_CONFIG, getTierCategory, isOperationalSource } from '../web/js/config.js';
import { computePageSlice, getProcessedItems, loadData, resetStateFilters, state, toggleSortColumn } from '../web/js/state.js';
import { renderTableHead } from '../web/js/table.js';
import { nextTabIndex } from '../web/js/utils.js';

const tierCases = JSON.parse(readFileSync(new URL('./tier_cases.json', import.meta.url), 'utf8'));

test('getTierCategory + isOperationalSource mirror the shared tier fixture', () => {
  for (const c of tierCases) {
    const item = { status: c.status, subcategory: c.subcategory };
    const label = `${c.status || '(empty)'}/${c.subcategory || '(none)'}`;
    assert.equal(getTierCategory(item), c.category, `getTierCategory ${label}`);
    assert.equal(isOperationalSource(item), c.operational, `isOperationalSource ${label}`);
  }
  assert.equal(getTierCategory(null), 'inaccessible_offline');
  assert.equal(isOperationalSource(null), false);
});

test('STATUS_CONFIG covers every status slug the tier fixture names', () => {
  for (const c of tierCases) {
    if (!c.status) continue;
    assert.ok(STATUS_CONFIG[c.status], `missing STATUS_CONFIG.${c.status}`);
    assert.ok(STATUS_CONFIG[c.status].label, `missing label for ${c.status}`);
  }
});

const EXTENSIONS = {
  results: [
    { status: 'ok', name: 'Alpha', url: 'https://alpha.test', info: '', subcategory: '', http_code: 200, duration: 1 },
    { status: 'error', name: 'Beta', url: 'https://beta.test', info: 'boom', subcategory: '', http_code: 500, duration: 2 },
  ],
};

function seedExtensions() {
  state.activeTab = 'extensions';
  state.data.extensions = EXTENSIONS;
  state.filterStatus = 'all';
  state.searchQuery = '';
  state.currentPage = 1;
  state.sortColumn = null;
  state.sortDirection = 'asc';
}

test('getProcessedItems filters by status', () => {
  seedExtensions();
  assert.equal(getProcessedItems().length, 2);
  state.filterStatus = 'error';
  assert.deepEqual(getProcessedItems().map((i) => i.name), ['Beta']);
});

test('getProcessedItems searches name, info, http_code, and operational', () => {
  seedExtensions();
  state.searchQuery = '500';
  assert.deepEqual(getProcessedItems().map((i) => i.name), ['Beta']);
  state.searchQuery = 'boom';
  assert.deepEqual(getProcessedItems().map((i) => i.name), ['Beta']);
  state.searchQuery = 'operational';
  assert.deepEqual(getProcessedItems().map((i) => i.name), ['Alpha']);
});

test('getProcessedItems sorts by status rank', () => {
  seedExtensions();
  state.sortColumn = 'status';
  state.sortDirection = 'asc';
  assert.deepEqual(getProcessedItems().map((i) => i.status), ['ok', 'error']);
});

test('toggleSortColumn cycles asc -> desc -> off', () => {
  seedExtensions();
  toggleSortColumn('name');
  assert.deepEqual([state.sortColumn, state.sortDirection], ['name', 'asc']);
  toggleSortColumn('name');
  assert.deepEqual([state.sortColumn, state.sortDirection], ['name', 'desc']);
  toggleSortColumn('name');
  assert.deepEqual([state.sortColumn, state.sortDirection], [null, 'asc']);
});

test('resetStateFilters clears filter, search, sort, and page', () => {
  state.filterStatus = 'error';
  state.searchQuery = 'x';
  state.currentPage = 9;
  state.sortColumn = 'name';
  state.sortDirection = 'desc';
  resetStateFilters();
  assert.deepEqual(
    [state.filterStatus, state.searchQuery, state.currentPage, state.sortColumn, state.sortDirection],
    ['all', '', 1, null, 'asc'],
  );
});

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

test('index.html has a distinct load-error state and a noscript fallback', () => {
  assert.match(indexHtml, /id="errorState"/);
  assert.match(indexHtml, /id="retryLoadBtn"/);
  assert.match(indexHtml, /<noscript>/);
});

test('loadData rejects on a failed fetch instead of resolving null', async () => {
  state.data.issues = null;
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    await assert.rejects(() => loadData('issues'), /503/);
  } finally {
    globalThis.fetch = original;
    state.data.issues = null;
  }
});

test('sortable headers expose a keyboard-reachable button', () => {
  const head = renderTableHead('extensions', null, 'asc');
  assert.match(head, /aria-sort="none"/);
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

test('computePageSlice clamps an out-of-range page instead of yielding an empty slice', () => {
  assert.deepEqual(computePageSlice(120, 50, 9), { page: 3, totalPages: 3, size: 50, start: 100, end: 120, isAll: false });
  assert.deepEqual(computePageSlice(0, 50, 1), { page: 1, totalPages: 1, size: 50, start: 0, end: 0, isAll: false });
  assert.deepEqual(computePageSlice(120, 'all', 1), { page: 1, totalPages: 1, size: 120, start: 0, end: 120, isAll: true });
  assert.deepEqual(computePageSlice(120, 50, 0), { page: 1, totalPages: 3, size: 50, start: 0, end: 50, isAll: false });
});

test('workflow push paths include the Tailwind build inputs', () => {
  const wf = readFileSync(new URL('../.github/workflows/status.yaml', import.meta.url), 'utf8');
  const paths = wf.slice(wf.indexOf('  push:'), wf.indexOf('concurrency:'));
  for (const p of ['tailwind.config.js', 'package.json', 'package-lock.json', 'tests/**']) {
    assert.ok(paths.includes(p), `push paths must include ${p} so a config/lockfile change rebuilds app.css`);
  }
});
