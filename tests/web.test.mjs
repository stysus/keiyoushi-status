// Pure-logic self-checks for the web dashboard. No DOM/jsdom: only the
// functions that decide filtering, sorting, and tier display are exercised.
//
// Run: node --test 'tests/**/*.test.mjs'

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { STATUS_CONFIG, getTierCategory, isOperationalSource } from '../web/js/config.js';
import { getProcessedItems, resetStateFilters, state, toggleSortColumn } from '../web/js/state.js';

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
