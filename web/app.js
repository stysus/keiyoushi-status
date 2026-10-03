import { initTheme } from './js/theme.js';
import { debounce, copyTextToClipboard, nextTabIndex } from './js/utils.js';
import { renderFilterChips, renderPaginationButtons, showToast } from './js/components.js';
import { renderTableHead, renderTableRows } from './js/table.js';
import { state, loadData, getProcessedItems, toggleSortColumn, resetStateFilters, readStateFromUrl, writeStateToUrl, computePageSlice } from './js/state.js';
import { updateHeroOverview, updateTabBadges, updateTrend } from './js/overview.js';
import { exportFilteredData } from './js/export.js';

// DOM Elements Cache
const el = {
  themeToggle: document.getElementById('themeToggle'),
  sunIcon: document.getElementById('sunIcon'),
  moonIcon: document.getElementById('moonIcon'),
  // Hero
  heroPulse: document.getElementById('heroPulse'),
  heroDot: document.getElementById('heroDot'),
  heroStatusText: document.getElementById('heroStatusText'),
  lastUpdatedRelative: document.getElementById('lastUpdatedRelative'),
  trendContainer: document.getElementById('trendContainer'),
  trendSparkline: document.getElementById('trendSparkline'),
  trendValue: document.getElementById('trendValue'),
  barOk: document.getElementById('barOk'),
  barChallenge: document.getElementById('barChallenge'),
  barDegraded: document.getElementById('barDegraded'),
  barOffline: document.getElementById('barOffline'),
  // Stats
  statTotal: document.getElementById('statTotal'),
  statOk: document.getElementById('statOk'),
  statChallenge: document.getElementById('statChallenge'),
  statDegraded: document.getElementById('statDegraded'),
  statOffline: document.getElementById('statOffline'),
  // Tabs & Navigation
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabCountExtensions: document.getElementById('tabCountExtensions'),
  tabCountIssues: document.getElementById('tabCountIssues'),
  tabCountMap: document.getElementById('tabCountMap'),
  // Controls
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  pageSizeSelect: document.getElementById('pageSizeSelect'),
  filterChipsContainer: document.getElementById('filterChipsContainer'),
  exportBtn: document.getElementById('exportBtn'),
  exportMenu: document.getElementById('exportMenu'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  // Table
  tableWrapper: document.getElementById('tableWrapper'),
  tableHead: document.getElementById('tableHead'),
  tableBody: document.getElementById('tableBody'),
  loadingState: document.getElementById('loadingState'),
  emptyState: document.getElementById('emptyState'),
  errorState: document.getElementById('errorState'),
  retryLoadBtn: document.getElementById('retryLoadBtn'),
  resetFiltersBtn: document.getElementById('resetFiltersBtn'),
  // Pagination
  pageStart: document.getElementById('pageStart'),
  pageEnd: document.getElementById('pageEnd'),
  pageTotal: document.getElementById('pageTotal'),
  paginationButtons: document.getElementById('paginationButtons'),
  // Toast
  toast: document.getElementById('toast'),
  toastMsg: document.getElementById('toastMsg'),
};

// -------------------------------------------------------------
// Master Render View
// -------------------------------------------------------------
async function renderActiveTab() {
  el.loadingState.classList.remove('hidden');
  el.tableWrapper.classList.add('hidden');
  el.emptyState.classList.add('hidden');
  el.errorState.classList.add('hidden');

  let data;
  try {
    data = await loadData(state.activeTab);
  } catch (err) {
    el.loadingState.classList.add('hidden');
    el.errorState.classList.remove('hidden');
    return;
  }
  el.loadingState.classList.add('hidden');

  if (!data || !data.results) {
    el.emptyState.classList.remove('hidden');
    return;
  }

  updateHeroOverview(el);
  updateTabBadges(el);
  el.filterChipsContainer.innerHTML = renderFilterChips(data.results, state.filterStatus, state.activeTab);

  const filtered = getProcessedItems();
  const { page, totalPages, start, end, isAll } = computePageSlice(filtered.length, state.pageSize, state.currentPage);
  state.currentPage = page;

  // Pagination footer is always rendered, even when the current filter is empty.
  el.pageStart.textContent = (filtered.length === 0 ? 0 : start + 1).toLocaleString();
  el.pageEnd.textContent = end.toLocaleString();
  el.pageTotal.textContent = filtered.length.toLocaleString();
  el.paginationButtons.innerHTML = renderPaginationButtons(page, totalPages);

  if (filtered.length === 0) {
    el.emptyState.classList.remove('hidden');
    el.tableWrapper.classList.add('hidden');
    return;
  }

  el.emptyState.classList.add('hidden');
  el.tableWrapper.classList.remove('hidden');

  el.tableHead.innerHTML = renderTableHead(state.activeTab, state.sortColumn, state.sortDirection);

  const pageItems = isAll ? filtered : filtered.slice(start, end);
  el.tableBody.innerHTML = renderTableRows(pageItems, state.activeTab);
}

// -------------------------------------------------------------
// Tab Switching
// -------------------------------------------------------------
const TAB_ACTIVE_CLASS =
  'tab-btn px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm border border-zinc-200 dark:border-zinc-700 font-semibold cursor-pointer';
const TAB_INACTIVE_CLASS =
  'tab-btn px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white font-medium cursor-pointer';
const TAB_BADGE_ACTIVE_CLASS =
  'w-4 h-4 rounded text-xs font-mono flex items-center justify-center bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600 font-medium';
const TAB_BADGE_INACTIVE_CLASS =
  'w-4 h-4 rounded text-xs font-mono flex items-center justify-center bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400';

function applyTabStyles(targetTab) {
  el.tabBtns.forEach((btn) => {
    const isTarget = btn.dataset.tab === targetTab;
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    btn.tabIndex = isTarget ? 0 : -1;
    btn.className = isTarget ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS;
    const numBadge = btn.querySelector('span:first-child');
    if (numBadge) {
      numBadge.className = isTarget ? TAB_BADGE_ACTIVE_CLASS : TAB_BADGE_INACTIVE_CLASS;
    }
  });
}

function switchTab(targetTab) {
  if (state.activeTab === targetTab) return;

  state.activeTab = targetTab;
  state.filterStatus = 'all';
  state.currentPage = 1;
  state.sortColumn = null;
  state.sortDirection = 'asc';

  applyTabStyles(targetTab);
  writeStateToUrl();
  renderActiveTab();
}

// -------------------------------------------------------------
// Modern Event Delegation & Listener Setup
// -------------------------------------------------------------
function setupEvents() {
  // 1. Tab Clicks
  el.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 1b. Tab keyboard navigation (roving tabindex)
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

  // 2. Search Input with Debounce
  const debouncedSearch = debounce(() => {
    state.currentPage = 1;
    writeStateToUrl();
    renderActiveTab();
  }, 120);

  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    el.clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    debouncedSearch();
  });

  el.clearSearchBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    state.searchQuery = '';
    el.clearSearchBtn.classList.add('hidden');
    state.currentPage = 1;
    writeStateToUrl();
    renderActiveTab();
  });

  // 3. Page Size Change
  el.pageSizeSelect.addEventListener('change', (e) => {
    state.pageSize = e.target.value;
    state.currentPage = 1;
    renderActiveTab();
  });

  // 4. Delegated Event: Filter Chips Click
  el.filterChipsContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    const s = chip.dataset.status;
    state.filterStatus = state.filterStatus === s ? 'all' : s;
    state.currentPage = 1;
    writeStateToUrl();
    renderActiveTab();
  });

  // 5. Delegated Event: Table Header Sorting
  el.tableHead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    toggleSortColumn(th.dataset.sort);
    renderActiveTab();
  });

  // 6. Delegated Event: Table Row Copy URL
  el.tableBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-copy-url]');
    if (!btn) return;
    const url = btn.dataset.copyUrl;
    try {
      await copyTextToClipboard(url);
      showToast(el.toast, el.toastMsg, 'URL copied to clipboard');
      const originalSvg = btn.innerHTML;
      btn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
      setTimeout(() => {
        btn.innerHTML = originalSvg;
      }, 1500);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  });

  // 7. Delegated Event: Pagination Buttons Click
  el.paginationButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const p = parseInt(btn.dataset.page, 10);
    if (p && p !== state.currentPage) {
      state.currentPage = p;
      renderActiveTab();
      el.tableWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // 8. Reset Filters Button
  el.resetFiltersBtn.addEventListener('click', () => {
    resetStateFilters();
    el.searchInput.value = '';
    el.clearSearchBtn.classList.add('hidden');
    writeStateToUrl();
    renderActiveTab();
  });

  // 8b. Retry Load Button
  el.retryLoadBtn.addEventListener('click', () => {
    state.data[state.activeTab] = null;
    renderActiveTab();
  });

  // 9. Export Dropdown Menu
  el.exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.exportMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!el.exportMenu.contains(e.target) && !el.exportBtn.contains(e.target)) {
      el.exportMenu.classList.add('hidden');
    }
  });

  el.exportCsvBtn.addEventListener('click', () => {
    el.exportMenu.classList.add('hidden');
    exportFilteredData(state.activeTab, getProcessedItems(), 'csv', (name) => {
      showToast(el.toast, el.toastMsg, `Exported ${name}`);
    });
  });

  el.exportJsonBtn.addEventListener('click', () => {
    el.exportMenu.classList.add('hidden');
    exportFilteredData(state.activeTab, getProcessedItems(), 'json', (name) => {
      showToast(el.toast, el.toastMsg, `Exported ${name}`);
    });
  });

  // 10. Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== el.searchInput) {
      e.preventDefault();
      el.searchInput.focus();
    } else if (e.key === 'Escape') {
      if (document.activeElement === el.searchInput) {
        el.searchInput.blur();
      }
      el.exportMenu.classList.add('hidden');
    }
  });
}

// -------------------------------------------------------------
// App Bootstrap
// -------------------------------------------------------------
function initApp() {
  initTheme(el.themeToggle, el.sunIcon, el.moonIcon);
  readStateFromUrl();
  applyTabStyles(state.activeTab);
  el.searchInput.value = state.searchQuery;
  el.clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
  setupEvents();
  renderActiveTab();
  updateTrend(el);
}

// Launch application on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
