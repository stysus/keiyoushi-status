// Keiyoushi Status Dashboard - Main Application Controller (ESM)

import { initTheme } from './js/theme.js';
import { formatRelativeTime, debounce, copyTextToClipboard } from './js/utils.js';
import { renderFilterChips, renderPaginationButtons, showToast } from './js/components.js';
import { renderTableHead, renderTableRows } from './js/table.js';
import { state, loadData, getProcessedItems, toggleSortColumn, resetStateFilters } from './js/state.js';
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
  barOk: document.getElementById('barOk'),
  barRedirect: document.getElementById('barRedirect'),
  barIuam: document.getElementById('barIuam'),
  barBlock: document.getElementById('barBlock'),
  barError: document.getElementById('barError'),
  // Stats
  statTotal: document.getElementById('statTotal'),
  statOk: document.getElementById('statOk'),
  statRedirect: document.getElementById('statRedirect'),
  statIuam: document.getElementById('statIuam'),
  statBlock: document.getElementById('statBlock'),
  statError: document.getElementById('statError'),
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
// Hero Overview & Tab Badges
// -------------------------------------------------------------
function updateHeroOverview() {
  const ext = state.data.extensions;
  if (!ext || !ext.results) return;

  const list = ext.results;
  const total = list.length;
  let ok = 0;
  let redirect = 0;
  let iuam = 0;
  let block = 0;
  let error = 0;

  for (const item of list) {
    const s = item.status;
    if (s === '✅') ok++;
    else if (s === '🔀') redirect++;
    else if (s === '🚧' || s === '🛡️') iuam++;
    else if (s === '🛑') block++;
    else error++;
  }

  el.statTotal.textContent = total.toLocaleString();
  el.statOk.textContent = ok.toLocaleString();
  el.statRedirect.textContent = redirect.toLocaleString();
  el.statIuam.textContent = iuam.toLocaleString();
  el.statBlock.textContent = block.toLocaleString();
  el.statError.textContent = error.toLocaleString();

  // Percentages for status bar
  const pOk = (ok / total) * 100;
  const pRedirect = (redirect / total) * 100;
  const pIuam = (iuam / total) * 100;
  const pBlock = (block / total) * 100;
  const pError = (error / total) * 100;

  el.barOk.style.width = `${pOk}%`;
  el.barRedirect.style.width = `${pRedirect}%`;
  el.barIuam.style.width = `${pIuam}%`;
  el.barBlock.style.width = `${pBlock}%`;
  el.barError.style.width = `${pError}%`;

  // Headline
  const percentage = pOk.toFixed(1);
  el.heroStatusText.innerHTML = `<span>${percentage}% Sources Operational</span>`;

  if (pOk >= 90) {
    el.heroPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
    el.heroDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-emerald-500';
  } else if (pOk >= 75) {
    el.heroPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
    el.heroDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-amber-500';
  } else {
    el.heroPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75';
    el.heroDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-rose-500';
  }

  // Timestamp
  if (ext.timestamp) {
    const rel = formatRelativeTime(ext.timestamp);
    el.lastUpdatedRelative.textContent = `Checked ${rel}`;
    el.lastUpdatedRelative.title = `${ext.timestamp} (UTC)`;
  }
}

function updateTabBadges() {
  if (state.data.extensions) {
    el.tabCountExtensions.textContent = (state.data.extensions.results || []).length.toLocaleString();
  }
  if (state.data.issues) {
    el.tabCountIssues.textContent = (state.data.issues.results || []).length.toLocaleString();
  }
  if (state.data.map) {
    el.tabCountMap.textContent = (state.data.map.results || []).length.toLocaleString();
  }
}

// -------------------------------------------------------------
// Pagination Rendering
// -------------------------------------------------------------
function renderPagination(totalCount) {
  const isAll = state.pageSize === 'all';
  const pageSize = isAll ? totalCount : parseInt(state.pageSize, 10);
  const totalPages = isAll || totalCount === 0 ? 1 : Math.ceil(totalCount / pageSize);

  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIdx = totalCount === 0 ? 0 : (state.currentPage - 1) * pageSize + 1;
  const endIdx = isAll ? totalCount : Math.min(state.currentPage * pageSize, totalCount);

  el.pageStart.textContent = startIdx.toLocaleString();
  el.pageEnd.textContent = endIdx.toLocaleString();
  el.pageTotal.textContent = totalCount.toLocaleString();

  el.paginationButtons.innerHTML = renderPaginationButtons(state.currentPage, totalPages);
}

// -------------------------------------------------------------
// Master Render View
// -------------------------------------------------------------
async function renderActiveTab() {
  el.loadingState.classList.remove('hidden');
  el.tableWrapper.classList.add('hidden');
  el.emptyState.classList.add('hidden');

  const data = await loadData(state.activeTab);
  el.loadingState.classList.add('hidden');

  if (!data || !data.results) {
    el.emptyState.classList.remove('hidden');
    return;
  }

  updateHeroOverview();
  updateTabBadges();
  el.filterChipsContainer.innerHTML = renderFilterChips(data.results, state.filterStatus, state.activeTab);

  const filtered = getProcessedItems();

  if (filtered.length === 0) {
    el.emptyState.classList.remove('hidden');
    el.tableWrapper.classList.add('hidden');
    renderPagination(0);
    return;
  }

  el.emptyState.classList.add('hidden');
  el.tableWrapper.classList.remove('hidden');

  el.tableHead.innerHTML = renderTableHead(state.activeTab, state.sortColumn, state.sortDirection);

  const isAll = state.pageSize === 'all';
  const pageSize = isAll ? filtered.length : parseInt(state.pageSize, 10);
  const startIdx = (state.currentPage - 1) * pageSize;
  const pageItems = isAll ? filtered : filtered.slice(startIdx, startIdx + pageSize);

  el.tableBody.innerHTML = renderTableRows(pageItems, state.activeTab);
  renderPagination(filtered.length);
}

// -------------------------------------------------------------
// Tab Switching
// -------------------------------------------------------------
function switchTab(targetTab) {
  if (state.activeTab === targetTab) return;

  state.activeTab = targetTab;
  state.filterStatus = 'all';
  state.currentPage = 1;
  state.sortColumn = null;
  state.sortDirection = 'asc';

  el.tabBtns.forEach((btn) => {
    const isTarget = btn.dataset.tab === targetTab;
    if (isTarget) {
      btn.className =
        'tab-btn px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm border border-zinc-200 dark:border-zinc-700 font-semibold cursor-pointer';
      const numBadge = btn.querySelector('span:first-child');
      if (numBadge) {
        numBadge.className =
          'w-4 h-4 rounded text-xs font-mono flex items-center justify-center bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600 font-medium';
      }
    } else {
      btn.className =
        'tab-btn px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white font-medium cursor-pointer';
      const numBadge = btn.querySelector('span:first-child');
      if (numBadge) {
        numBadge.className =
          'w-4 h-4 rounded text-xs font-mono flex items-center justify-center bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400';
      }
    }
  });

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

  // 2. Search Input with Debounce
  const debouncedSearch = debounce(() => {
    state.currentPage = 1;
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
  setupEvents();
  renderActiveTab();
}

// Launch application on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
