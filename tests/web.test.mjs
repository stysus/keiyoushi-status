// Pure-logic self-checks for the web dashboard. No DOM/jsdom: only the
// functions that decide filtering, sorting, and tier display are exercised.
//
// Run: node --test 'tests/**/*.test.mjs'

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { STATUS_CONFIG, getTierCategory, isOperationalSource } from '../web/js/config.js';
import { getProcessedItems, loadData, resetStateFilters, state, toggleSortColumn } from '../web/js/state.js';

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
