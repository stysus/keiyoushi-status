// Keiyoushi Status Dashboard Script
(function () {
  'use strict';

  // State
  const state = {
    activeTab: 'extensions', // 'extensions' | 'issues' | 'map'
    data: {
      extensions: null,
      issues: null,
      map: null,
    },
    filterStatus: 'all',
    searchQuery: '',
    pageSize: 50,
    currentPage: 1,
    sortField: null,
    sortAsc: true,
  };

  // Status Definitions & Friendly Names
  const STATUS_META = {
    '✅': { label: 'OK', color: 'emerald' },
    '🔀': { label: 'Redirect', color: 'blue' },
    '🚧': { label: 'IUAM', color: 'amber' },
    '🛑': { label: 'Blocked', color: 'rose' },
    '🅿️': { label: 'Parked', color: 'purple' },
    '🪧': { label: 'Placeholder', color: 'cyan' },
    '⚠️': { label: 'Warning', color: 'yellow' },
    '❌': { label: 'Error', color: 'red' },
    '🔍': { label: 'Not Found', color: 'slate' },
  };

  // DOM Elements
  const elements = {
    themeToggle: document.getElementById('themeToggle'),
    sunIcon: document.getElementById('sunIcon'),
    moonIcon: document.getElementById('moonIcon'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    pageSizeSelect: document.getElementById('pageSizeSelect'),
    filterChipsContainer: document.getElementById('filterChipsContainer'),
    tableWrapper: document.getElementById('tableWrapper'),
    tableHead: document.getElementById('tableHead'),
    tableBody: document.getElementById('tableBody'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    resetFiltersBtn: document.getElementById('resetFiltersBtn'),
    paginationContainer: document.getElementById('paginationContainer'),
    pageStart: document.getElementById('pageStart'),
    pageEnd: document.getElementById('pageEnd'),
    pageTotal: document.getElementById('pageTotal'),
    paginationButtons: document.getElementById('paginationButtons'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toastMsg'),
    lastUpdated: document.getElementById('lastUpdated'),
    // Stats
    statTotal: document.getElementById('statTotal'),
    statOk: document.getElementById('statOk'),
    statRedirect: document.getElementById('statRedirect'),
    statIuam: document.getElementById('statIuam'),
    statBlock: document.getElementById('statBlock'),
    statError: document.getElementById('statError'),
    // Tab buttons & badges
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabCountExtensions: document.getElementById('tabCountExtensions'),
    tabCountIssues: document.getElementById('tabCountIssues'),
    tabCountMap: document.getElementById('tabCountMap'),
  };

  // -------------------------------------------------------------
  // Theme Management
  // -------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('keiyoushi-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;

    applyTheme(isDark);

    elements.themeToggle.addEventListener('click', () => {
      const willBeDark = !document.documentElement.classList.contains('dark');
      applyTheme(willBeDark);
      localStorage.setItem('keiyoushi-theme', willBeDark ? 'dark' : 'light');
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('keiyoushi-theme')) {
        applyTheme(e.matches);
      }
    });
  }

  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.classList.add('dark');
      elements.sunIcon.classList.remove('hidden');
      elements.moonIcon.classList.add('hidden');
    } else {
      document.documentElement.classList.remove('dark');
      elements.sunIcon.classList.add('hidden');
      elements.moonIcon.classList.remove('hidden');
    }
  }

  // -------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------
  async function loadData(tab) {
    if (state.data[tab]) {
      return state.data[tab];
    }

    const endpoints = {
      extensions: 'data/extensions.json',
      issues: 'data/issues.json',
      map: 'data/issue_map.json',
    };

    try {
      const res = await fetch(endpoints[tab]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      state.data[tab] = json;
      return json;
    } catch (err) {
      console.error(`Failed to load ${tab} data:`, err);
      return null;
    }
  }

  // -------------------------------------------------------------
  // Formatting & Helpers
  // -------------------------------------------------------------
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(isoStr) {
    if (!isoStr) return '-';
    try {
      const date = new Date(isoStr);
      return date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return isoStr;
    }
  }

  function showToast(message) {
    elements.toastMsg.textContent = message;
    elements.toast.classList.remove('translate-y-12', 'opacity-0');
    elements.toast.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(window.__toastTimeout);
    window.__toastTimeout = setTimeout(() => {
      elements.toast.classList.remove('translate-y-0', 'opacity-100');
      elements.toast.classList.add('translate-y-12', 'opacity-0');
    }, 2000);
  }

  window.copyText = function (text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('URL copied to clipboard!');
      });
    } else {
      const input = document.createElement('textarea');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast('URL copied to clipboard!');
    }
  };

  // -------------------------------------------------------------
  // Stats Calculation & Tab Badges
  // -------------------------------------------------------------
  function updateGlobalStats() {
    const extData = state.data.extensions;
    if (!extData || !extData.results) return;

    const list = extData.results;
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
      else if (s === '🚧') iuam++;
      else if (s === '🛑') block++;
      else if (s === '❌' || s === '⚠️' || s === '🅿️' || s === '🪧') error++;
    }

    elements.statTotal.textContent = total.toLocaleString();
    elements.statOk.textContent = ok.toLocaleString();
    elements.statRedirect.textContent = redirect.toLocaleString();
    elements.statIuam.textContent = iuam.toLocaleString();
    elements.statBlock.textContent = block.toLocaleString();
    elements.statError.textContent = error.toLocaleString();

    if (extData.timestamp) {
      elements.lastUpdated.textContent = formatTime(extData.timestamp);
    }
  }

  function updateTabBadges() {
    if (state.data.extensions) {
      elements.tabCountExtensions.textContent = (state.data.extensions.results || []).length.toLocaleString();
    }
    if (state.data.issues) {
      elements.tabCountIssues.textContent = (state.data.issues.results || []).length.toLocaleString();
    }
    if (state.data.map) {
      elements.tabCountMap.textContent = (state.data.map.results || []).length.toLocaleString();
    }
  }

  // -------------------------------------------------------------
  // Filter Chips Rendering
  // -------------------------------------------------------------
  function renderFilterChips(items) {
    const counts = { all: items.length };
    for (const item of items) {
      let status = item.status;
      if (state.activeTab === 'map') {
        status = item.matches && item.matches.length > 0 ? item.matches[0].status : '🔍';
      }
      counts[status] = (counts[status] || 0) + 1;
    }

    let chipsHtml = `
      <button type="button" class="filter-chip px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
        state.filterStatus === 'all'
          ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white shadow-sm'
          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
      }" data-status="all">
        <span>All</span>
        <span class="text-[10px] px-1.5 py-0.2 rounded-full ${
          state.filterStatus === 'all' ? 'bg-slate-800 dark:bg-slate-200' : 'bg-slate-100 dark:bg-slate-800'
        }">${counts.all}</span>
      </button>
    `;

    for (const [emoji, meta] of Object.entries(STATUS_META)) {
      if (!counts[emoji]) continue;
      const isActive = state.filterStatus === emoji;
      chipsHtml += `
        <button type="button" class="filter-chip px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
          isActive
            ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white shadow-sm'
            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
        }" data-status="${emoji}">
          <span>${emoji} ${meta.label}</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded-full ${
            isActive ? 'bg-slate-800 dark:bg-slate-200' : 'bg-slate-100 dark:bg-slate-800'
          }">${counts[emoji]}</span>
        </button>
      `;
    }

    elements.filterChipsContainer.innerHTML = chipsHtml;

    elements.filterChipsContainer.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selected = btn.dataset.status;
        state.filterStatus = state.filterStatus === selected ? 'all' : selected;
        state.currentPage = 1;
        renderActiveTab();
      });
    });
  }

  // -------------------------------------------------------------
  // Data Filtering & Searching
  // -------------------------------------------------------------
  function getFilteredItems() {
    const rawData = state.data[state.activeTab];
    if (!rawData || !rawData.results) return [];

    let items = rawData.results;
    const q = state.searchQuery.trim().toLowerCase();

    // 1. Filter by status
    if (state.filterStatus !== 'all') {
      if (state.activeTab === 'map') {
        items = items.filter((item) => {
          if (!item.matches || item.matches.length === 0) return state.filterStatus === '🔍';
          return item.matches.some((m) => m.status === state.filterStatus);
        });
      } else {
        items = items.filter((item) => item.status === state.filterStatus);
      }
    }

    // 2. Filter by search query
    if (q) {
      if (state.activeTab === 'extensions') {
        items = items.filter(
          (item) =>
            (item.name && item.name.toLowerCase().includes(q)) ||
            (item.url && item.url.toLowerCase().includes(q)) ||
            (item.info && item.info.toLowerCase().includes(q)) ||
            (item.subcategory && item.subcategory.toLowerCase().includes(q))
        );
      } else if (state.activeTab === 'issues') {
        items = items.filter(
          (item) =>
            (item.url && item.url.toLowerCase().includes(q)) ||
            String(item.pr_number).includes(q) ||
            (item.labels && item.labels.toLowerCase().includes(q)) ||
            (item.info && item.info.toLowerCase().includes(q))
        );
      } else if (state.activeTab === 'map') {
        items = items.filter(
          (item) =>
            (item.title && item.title.toLowerCase().includes(q)) ||
            (item.source_name && item.source_name.toLowerCase().includes(q)) ||
            String(item.number).includes(q) ||
            (item.matches &&
              item.matches.some(
                (m) =>
                  (m.name && m.name.toLowerCase().includes(q)) ||
                  (m.url && m.url.toLowerCase().includes(q)) ||
                  (m.methods && m.methods.some((mth) => mth.toLowerCase().includes(q)))
              ))
        );
      }
    }

    return items;
  }

  // -------------------------------------------------------------
  // Render Tables
  // -------------------------------------------------------------
  function renderTableHead() {
    if (state.activeTab === 'extensions') {
      elements.tableHead.innerHTML = `
        <tr>
          <th class="py-3 px-4 w-16 text-center">Status</th>
          <th class="py-3 px-4 font-semibold">Extension Name</th>
          <th class="py-3 px-4 font-semibold">URL</th>
          <th class="py-3 px-4 w-28 text-right font-semibold">Response</th>
          <th class="py-3 px-4 font-semibold">Notes / Info</th>
          <th class="py-3 px-4 w-16 text-center font-semibold">Action</th>
        </tr>
      `;
    } else if (state.activeTab === 'issues') {
      elements.tableHead.innerHTML = `
        <tr>
          <th class="py-3 px-4 w-16 text-center">Status</th>
          <th class="py-3 px-4 w-28 font-semibold">Issue</th>
          <th class="py-3 px-4 font-semibold">URL</th>
          <th class="py-3 px-4 w-28 text-right font-semibold">Response</th>
          <th class="py-3 px-4 font-semibold">Labels</th>
          <th class="py-3 px-4 font-semibold">Info</th>
          <th class="py-3 px-4 w-16 text-center font-semibold">Action</th>
        </tr>
      `;
    } else if (state.activeTab === 'map') {
      elements.tableHead.innerHTML = `
        <tr>
          <th class="py-3 px-4 w-32 font-semibold">Bug Issue</th>
          <th class="py-3 px-4 font-semibold">Issue Source</th>
          <th class="py-3 px-4 w-16 text-center">Status</th>
          <th class="py-3 px-4 font-semibold">Matched Extension</th>
          <th class="py-3 px-4 font-semibold">Target URL</th>
          <th class="py-3 px-4 w-16 text-center font-semibold">Action</th>
        </tr>
      `;
    }
  }

  function renderTableRows(pageItems) {
    let rowsHtml = '';

    if (state.activeTab === 'extensions') {
      for (const item of pageItems) {
        const subcatBadge = item.subcategory
          ? `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 mr-1.5 font-medium">${escapeHtml(
              item.subcategory
            )}</span>`
          : '';
        const infoText = item.info ? `<span class="text-xs text-slate-500">${escapeHtml(item.info)}</span>` : '';

        rowsHtml += `
          <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
            <td class="py-2.5 px-4 text-center text-lg select-none">${item.status}</td>
            <td class="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
              ${escapeHtml(item.name)}
            </td>
            <td class="py-2.5 px-4 font-mono text-xs">
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" 
                 class="text-brand-600 dark:text-brand-400 hover:underline break-all inline-flex items-center gap-1">
                ${escapeHtml(item.url)}
                <svg class="w-3 h-3 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </a>
            </td>
            <td class="py-2.5 px-4 text-right font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              ${escapeHtml(item.time || '-')}
            </td>
            <td class="py-2.5 px-4">
              ${subcatBadge}${infoText || '<span class="text-slate-400">-</span>'}
            </td>
            <td class="py-2.5 px-4 text-center">
              <button onclick="copyText('${escapeHtml(item.url)}')" title="Copy URL" 
                      class="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              </button>
            </td>
          </tr>
        `;
      }
    } else if (state.activeTab === 'issues') {
      for (const item of pageItems) {
        const ghIssueUrl = `https://github.com/keiyoushi/extensions-source/issues/${item.pr_number}`;
        const labelsBadge = item.labels
          ? item.labels
              .split(',')
              .map(
                (lbl) =>
                  `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 mr-1 font-medium">${escapeHtml(
                    lbl.trim()
                  )}</span>`
              )
              .join('')
          : '<span class="text-slate-400">-</span>';

        const subcatBadge = item.subcategory
          ? `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 mr-1.5 font-medium">${escapeHtml(
              item.subcategory
            )}</span>`
          : '';

        rowsHtml += `
          <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
            <td class="py-2.5 px-4 text-center text-lg select-none">${item.status}</td>
            <td class="py-2.5 px-4 whitespace-nowrap font-medium font-mono text-xs">
              <a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                 class="text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
                #${item.pr_number}
                <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </a>
            </td>
            <td class="py-2.5 px-4 font-mono text-xs">
              ${
                item.url
                  ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" 
                        class="text-brand-600 dark:text-brand-400 hover:underline break-all inline-flex items-center gap-1">
                       ${escapeHtml(item.url)}
                       <svg class="w-3 h-3 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                     </a>`
                  : '<span class="text-slate-400 italic">No URL extracted</span>'
              }
            </td>
            <td class="py-2.5 px-4 text-right font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              ${escapeHtml(item.time || '-')}
            </td>
            <td class="py-2.5 px-4 whitespace-nowrap">${labelsBadge}</td>
            <td class="py-2.5 px-4">${subcatBadge}${escapeHtml(item.info) || '<span class="text-slate-400">-</span>'}</td>
            <td class="py-2.5 px-4 text-center">
              ${
                item.url
                  ? `<button onclick="copyText('${escapeHtml(item.url)}')" title="Copy URL" 
                             class="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                       <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                     </button>`
                  : ''
              }
            </td>
          </tr>
        `;
      }
    } else if (state.activeTab === 'map') {
      for (const item of pageItems) {
        const ghIssueUrl = `https://github.com/keiyoushi/extensions-source/issues/${item.number}`;
        const hasMatches = item.matches && item.matches.length > 0;

        if (!hasMatches) {
          rowsHtml += `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
              <td class="py-2.5 px-4 font-mono text-xs">
                <a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                   class="text-brand-600 dark:text-brand-400 hover:underline font-semibold block">
                  #${item.number}
                </a>
                <span class="text-slate-600 dark:text-slate-300 text-xs">${escapeHtml(item.title)}</span>
              </td>
              <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">${escapeHtml(
                item.source_name || '-'
              )}</td>
              <td class="py-2.5 px-4 text-center text-slate-400 text-sm">🔍</td>
              <td class="py-2.5 px-4 text-slate-400 italic">No match found</td>
              <td class="py-2.5 px-4 text-slate-400">-</td>
              <td class="py-2.5 px-4 text-center text-slate-400">-</td>
            </tr>
          `;
        } else {
          item.matches.forEach((m, idx) => {
            const scoreBadge = `<span class="inline-block px-1.5 py-0.2 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono ml-1.5">${m.score}%</span>`;
            const methodsBadge = (m.methods || [])
              .map(
                (mth) =>
                  `<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300 font-mono mr-1">${escapeHtml(
                    mth
                  )}</span>`
              )
              .join('');

            rowsHtml += `
              <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                idx > 0 ? 'bg-slate-50/30 dark:bg-slate-900/30' : ''
              }">
                <td class="py-2.5 px-4 font-mono text-xs">
                  ${
                    idx === 0
                      ? `<a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                            class="text-brand-600 dark:text-brand-400 hover:underline font-semibold block">
                           #${item.number}
                         </a>
                         <span class="text-slate-600 dark:text-slate-300 text-xs">${escapeHtml(item.title)}</span>`
                      : `<span class="text-slate-400 pl-4 text-xs font-mono">↳ #${item.number}</span>`
                  }
                </td>
                <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  ${idx === 0 ? escapeHtml(item.source_name || '-') : ''}
                </td>
                <td class="py-2.5 px-4 text-center text-lg select-none">${m.status}</td>
                <td class="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  ${escapeHtml(m.name)}${scoreBadge}
                  <div class="mt-0.5">${methodsBadge}</div>
                </td>
                <td class="py-2.5 px-4 font-mono text-xs">
                  ${
                    m.url
                      ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" 
                            class="text-brand-600 dark:text-brand-400 hover:underline break-all inline-flex items-center gap-1">
                           ${escapeHtml(m.url)}
                           <svg class="w-3 h-3 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                         </a>`
                      : '<span class="text-slate-400">-</span>'
                  }
                </td>
                <td class="py-2.5 px-4 text-center">
                  ${
                    m.url
                      ? `<button onclick="copyText('${escapeHtml(m.url)}')" title="Copy URL" 
                                 class="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                           <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                         </button>`
                      : ''
                  }
                </td>
              </tr>
            `;
          });
        }
      }
    }

    elements.tableBody.innerHTML = rowsHtml;
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

    elements.pageStart.textContent = startIdx.toLocaleString();
    elements.pageEnd.textContent = endIdx.toLocaleString();
    elements.pageTotal.textContent = totalCount.toLocaleString();

    if (totalPages <= 1) {
      elements.paginationButtons.innerHTML = '';
      return;
    }

    let buttonsHtml = '';

    // Prev Button
    buttonsHtml += `
      <button class="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors" 
              data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? 'disabled' : ''}>
        Prev
      </button>
    `;

    // Page numbers with ellipsis
    const maxButtons = 5;
    let startPage = Math.max(1, state.currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
      buttonsHtml += `<button class="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" data-page="1">1</button>`;
      if (startPage > 2) buttonsHtml += `<span class="px-1 text-slate-400">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      const isActive = p === state.currentPage;
      buttonsHtml += `
        <button class="w-8 h-8 rounded-lg border transition-colors ${
          isActive
            ? 'bg-brand-600 text-white border-brand-600 font-semibold shadow-sm'
            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
        }" data-page="${p}">${p}</button>
      `;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) buttonsHtml += `<span class="px-1 text-slate-400">...</span>`;
      buttonsHtml += `<button class="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next Button
    buttonsHtml += `
      <button class="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors" 
              data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? 'disabled' : ''}>
        Next
      </button>
    `;

    elements.paginationButtons.innerHTML = buttonsHtml;

    elements.paginationButtons.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10);
        if (page && page !== state.currentPage) {
          state.currentPage = page;
          renderActiveTab();
          elements.tableWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // -------------------------------------------------------------
  // Master Render View
  // -------------------------------------------------------------
  async function renderActiveTab() {
    elements.loadingState.classList.remove('hidden');
    elements.tableWrapper.classList.add('hidden');
    elements.emptyState.classList.add('hidden');

    const data = await loadData(state.activeTab);
    elements.loadingState.classList.add('hidden');

    if (!data || !data.results) {
      elements.emptyState.classList.remove('hidden');
      return;
    }

    updateGlobalStats();
    updateTabBadges();

    // Render filter chips based on unfiltered raw data in active tab
    renderFilterChips(data.results);

    // Filtered data based on search & status chip
    const filteredItems = getFilteredItems();

    if (filteredItems.length === 0) {
      elements.emptyState.classList.remove('hidden');
      elements.tableWrapper.classList.add('hidden');
      renderPagination(0);
      return;
    }

    elements.emptyState.classList.add('hidden');
    elements.tableWrapper.classList.remove('hidden');

    renderTableHead();

    // Paginate
    const isAll = state.pageSize === 'all';
    const pageSize = isAll ? filteredItems.length : parseInt(state.pageSize, 10);
    const startIdx = (state.currentPage - 1) * pageSize;
    const pageItems = isAll ? filteredItems : filteredItems.slice(startIdx, startIdx + pageSize);

    renderTableRows(pageItems);
    renderPagination(filteredItems.length);
  }

  // -------------------------------------------------------------
  // Events & Initialization
  // -------------------------------------------------------------
  function setupEventListeners() {
    // Tab switching
    elements.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab === state.activeTab) return;

        state.activeTab = tab;
        state.filterStatus = 'all';
        state.currentPage = 1;

        elements.tabBtns.forEach((b) => {
          b.classList.remove('border-brand-600', 'text-brand-600', 'dark:text-brand-400');
          b.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        });
        btn.classList.add('border-brand-600', 'text-brand-600', 'dark:text-brand-400');
        btn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');

        renderActiveTab();
      });
    });

    // Search input
    let debounceTimer;
    elements.searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      state.searchQuery = e.target.value;
      if (state.searchQuery) {
        elements.clearSearchBtn.classList.remove('hidden');
      } else {
        elements.clearSearchBtn.classList.add('hidden');
      }
      debounceTimer = setTimeout(() => {
        state.currentPage = 1;
        renderActiveTab();
      }, 150);
    });

    elements.clearSearchBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      elements.clearSearchBtn.classList.add('hidden');
      state.currentPage = 1;
      renderActiveTab();
      elements.searchInput.focus();
    });

    // Keyboard shortcut '/' to search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== elements.searchInput) {
        e.preventDefault();
        elements.searchInput.focus();
      } else if (e.key === 'Escape' && document.activeElement === elements.searchInput) {
        elements.searchInput.blur();
      }
    });

    // Page size
    elements.pageSizeSelect.addEventListener('change', (e) => {
      state.pageSize = e.target.value;
      state.currentPage = 1;
      renderActiveTab();
    });

    // Reset filters button in empty state
    elements.resetFiltersBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      state.filterStatus = 'all';
      elements.clearSearchBtn.classList.add('hidden');
      state.currentPage = 1;
      renderActiveTab();
    });
  }

  // Init
  initTheme();
  setupEventListeners();

  // Preload extensions data and render initially
  loadData('extensions').then(() => {
    renderActiveTab();
    // Warm up the other tabs in the background
    loadData('issues');
    loadData('map');
  });
})();
