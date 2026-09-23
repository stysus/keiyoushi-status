// Keiyoushi Status Dashboard - Minimalist DevTool Edition
(function () {
  'use strict';

  // Global State
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
    sortColumn: null, // string
    sortDirection: 'asc', // 'asc' | 'desc'
  };

  // Status Definitions
  const STATUS_CONFIG = {
    '✅': { label: 'Operational', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    '🔀': { label: 'Redirect', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    '🚧': { label: 'IUAM', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    '🛑': { label: 'Blocked', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
    '🅿️': { label: 'Parked', dot: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    '🪧': { label: 'Placeholder', dot: 'bg-cyan-500', text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    '⚠️': { label: 'Warning', dot: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
    '❌': { label: 'Error', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    '🔍': { label: 'Not Found', dot: 'bg-zinc-400', text: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' },
  };

  // DOM Cache
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
  // Theme Manager
  // -------------------------------------------------------------
  function initTheme() {
    const saved = localStorage.getItem('keiyoushi-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved ? saved === 'dark' : prefersDark;

    applyTheme(isDark);

    el.themeToggle.addEventListener('click', () => {
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
      el.sunIcon.classList.remove('hidden');
      el.moonIcon.classList.add('hidden');
    } else {
      document.documentElement.classList.remove('dark');
      el.sunIcon.classList.add('hidden');
      el.moonIcon.classList.remove('hidden');
    }
  }

  // -------------------------------------------------------------
  // Data Loader
  // -------------------------------------------------------------
  async function loadData(tab) {
    if (state.data[tab]) return state.data[tab];

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
  // Helpers & Formatting
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

  function formatRelativeTime(isoString) {
    if (!isoString) return 'Unknown';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);

      if (diffSec < 60) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;
      if (diffDay === 1) return 'yesterday';
      return `${diffDay}d ago`;
    } catch {
      return isoString;
    }
  }

  function renderStatusPill(statusEmoji) {
    const conf = STATUS_CONFIG[statusEmoji] || {
      label: statusEmoji || 'Unknown',
      dot: 'bg-zinc-400',
      text: 'text-zinc-500',
      bg: 'bg-zinc-500/10',
      border: 'border-zinc-500/20',
    };

    return `
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium font-mono ${conf.bg} ${conf.text} border ${conf.border}">
        <span class="w-1.5 h-1.5 rounded-full ${conf.dot}"></span>
        <span>${conf.label}</span>
      </span>
    `;
  }

  function showToast(message) {
    el.toastMsg.textContent = message;
    el.toast.classList.remove('translate-y-8', 'opacity-0');
    el.toast.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(window.__toastTimeout);
    window.__toastTimeout = setTimeout(() => {
      el.toast.classList.remove('translate-y-0', 'opacity-100');
      el.toast.classList.add('translate-y-8', 'opacity-0');
    }, 1800);
  }

  window.copyUrlToClipboard = function (btn, url) {
    const copyAction = (navigator.clipboard && window.isSecureContext)
      ? navigator.clipboard.writeText(url)
      : new Promise((resolve) => {
          const input = document.createElement('textarea');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
          resolve();
        });

    copyAction.then(() => {
      showToast('URL copied to clipboard');
      // Visual button feedback
      const originalSvg = btn.innerHTML;
      btn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
      setTimeout(() => {
        btn.innerHTML = originalSvg;
      }, 1500);
    });
  };

  // -------------------------------------------------------------
  // Hero & Global Stats Calculation
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
      else if (s === '🚧') iuam++;
      else if (s === '🛑') block++;
      else error++;
    }

    el.statTotal.textContent = total.toLocaleString();
    el.statOk.textContent = ok.toLocaleString();
    el.statRedirect.textContent = redirect.toLocaleString();
    el.statIuam.textContent = iuam.toLocaleString();
    el.statBlock.textContent = block.toLocaleString();
    el.statError.textContent = error.toLocaleString();

    // Percentages for bar
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
  // Filter Chips
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
      <button type="button" class="filter-chip px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors flex items-center gap-1.5 ${
        state.filterStatus === 'all'
          ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100 shadow-sm'
          : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
      }" data-status="all">
        <span>All</span>
        <span class="text-[10px] px-1 rounded ${
          state.filterStatus === 'all' ? 'bg-zinc-800 text-zinc-200 dark:bg-zinc-200 dark:text-zinc-800' : 'text-zinc-400'
        }">${counts.all}</span>
      </button>
    `;

    for (const [emoji, conf] of Object.entries(STATUS_CONFIG)) {
      if (!counts[emoji]) continue;
      const isActive = state.filterStatus === emoji;
      chipsHtml += `
        <button type="button" class="filter-chip px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors flex items-center gap-1.5 ${
          isActive
            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100 shadow-sm'
            : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
        }" data-status="${emoji}">
          <span class="w-1.5 h-1.5 rounded-full ${conf.dot}"></span>
          <span>${conf.label}</span>
          <span class="text-[10px] px-1 rounded ${
            isActive ? 'bg-zinc-800 text-zinc-200 dark:bg-zinc-200 dark:text-zinc-800' : 'text-zinc-400'
          }">${counts[emoji]}</span>
        </button>
      `;
    }

    el.filterChipsContainer.innerHTML = chipsHtml;

    el.filterChipsContainer.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.status;
        state.filterStatus = state.filterStatus === s ? 'all' : s;
        state.currentPage = 1;
        renderActiveTab();
      });
    });
  }

  // -------------------------------------------------------------
  // Data Filtering & Column Sorting
  // -------------------------------------------------------------
  function getProcessedItems() {
    const rawData = state.data[state.activeTab];
    if (!rawData || !rawData.results) return [];

    let items = rawData.results;
    const q = state.searchQuery.trim().toLowerCase();

    // 1. Status Filter
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

    // 2. Query Search
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

    // 3. Column Sorting
    if (state.sortColumn) {
      const col = state.sortColumn;
      const asc = state.sortDirection === 'asc';

      items = [...items].sort((a, b) => {
        let valA, valB;

        if (state.activeTab === 'extensions') {
          if (col === 'name') {
            valA = (a.name || '').toLowerCase();
            valB = (b.name || '').toLowerCase();
          } else if (col === 'time') {
            valA = a.duration !== null && a.duration !== undefined ? a.duration : 9999;
            valB = b.duration !== null && b.duration !== undefined ? b.duration : 9999;
          } else if (col === 'status') {
            valA = a.status || '';
            valB = b.status || '';
          }
        } else if (state.activeTab === 'issues') {
          if (col === 'number') {
            valA = a.pr_number || 0;
            valB = b.pr_number || 0;
          } else if (col === 'time') {
            valA = a.duration !== null && a.duration !== undefined ? a.duration : 9999;
            valB = b.duration !== null && b.duration !== undefined ? b.duration : 9999;
          } else if (col === 'status') {
            valA = a.status || '';
            valB = b.status || '';
          }
        } else if (state.activeTab === 'map') {
          if (col === 'number') {
            valA = a.number || 0;
            valB = b.number || 0;
          } else if (col === 'source') {
            valA = (a.source_name || '').toLowerCase();
            valB = (b.source_name || '').toLowerCase();
          }
        }

        if (valA === valB) return 0;
        if (valA < valB) return asc ? -1 : 1;
        return asc ? 1 : -1;
      });
    }

    return items;
  }

  // -------------------------------------------------------------
  // Table Rendering
  // -------------------------------------------------------------
  function getSortIndicator(col) {
    if (state.sortColumn !== col) return `<span class="opacity-30 ml-1">↕</span>`;
    return state.sortDirection === 'asc' ? `<span class="text-zinc-900 dark:text-zinc-100 ml-1">↑</span>` : `<span class="text-zinc-900 dark:text-zinc-100 ml-1">↓</span>`;
  }

  function handleHeaderSort(col) {
    if (state.sortColumn === col) {
      if (state.sortDirection === 'asc') {
        state.sortDirection = 'desc';
      } else {
        state.sortColumn = null;
        state.sortDirection = 'asc';
      }
    } else {
      state.sortColumn = col;
      state.sortDirection = 'asc';
    }
    renderActiveTab();
  }

  function renderTableHead() {
    if (state.activeTab === 'extensions') {
      el.tableHead.innerHTML = `
        <tr>
          <th class="py-2.5 px-4 w-32 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="status">
            STATUS ${getSortIndicator('status')}
          </th>
          <th class="py-2.5 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="name">
            EXTENSION ${getSortIndicator('name')}
          </th>
          <th class="py-2.5 px-4 font-normal">URL</th>
          <th class="py-2.5 px-4 w-28 text-right cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="time">
            LATENCY ${getSortIndicator('time')}
          </th>
          <th class="py-2.5 px-4 font-normal">NOTES / CATEGORY</th>
          <th class="py-2.5 px-4 w-12 text-center font-normal"></th>
        </tr>
      `;
    } else if (state.activeTab === 'issues') {
      el.tableHead.innerHTML = `
        <tr>
          <th class="py-2.5 px-4 w-32 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="status">
            STATUS ${getSortIndicator('status')}
          </th>
          <th class="py-2.5 px-4 w-28 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="number">
            ISSUE ${getSortIndicator('number')}
          </th>
          <th class="py-2.5 px-4 font-normal">URL</th>
          <th class="py-2.5 px-4 w-28 text-right cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="time">
            LATENCY ${getSortIndicator('time')}
          </th>
          <th class="py-2.5 px-4 font-normal">LABELS</th>
          <th class="py-2.5 px-4 font-normal">INFO</th>
          <th class="py-2.5 px-4 w-12 text-center font-normal"></th>
        </tr>
      `;
    } else if (state.activeTab === 'map') {
      el.tableHead.innerHTML = `
        <tr>
          <th class="py-2.5 px-4 w-36 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="number">
            BUG ISSUE ${getSortIndicator('number')}
          </th>
          <th class="py-2.5 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors" data-sort="source">
            SOURCE ${getSortIndicator('source')}
          </th>
          <th class="py-2.5 px-4 w-28 font-normal">STATUS</th>
          <th class="py-2.5 px-4 font-normal">MATCHED EXTENSION</th>
          <th class="py-2.5 px-4 font-normal">TARGET URL</th>
          <th class="py-2.5 px-4 w-12 text-center font-normal"></th>
        </tr>
      `;
    }

    el.tableHead.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        handleHeaderSort(th.dataset.sort);
      });
    });
  }

  function renderTableRows(items) {
    let rowsHtml = '';

    if (state.activeTab === 'extensions') {
      for (const item of items) {
        const subcatBadge = item.subcategory
          ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 mr-1.5 border border-zinc-200 dark:border-zinc-700">${escapeHtml(item.subcategory)}</span>`
          : '';
        const infoText = item.info ? `<span class="text-xs text-zinc-500">${escapeHtml(item.info)}</span>` : '';

        // Response latency styling
        let latencyColor = 'text-zinc-400';
        if (item.duration !== null && item.duration !== undefined) {
          if (item.duration < 2.0) latencyColor = 'text-emerald-600 dark:text-emerald-400';
          else if (item.duration < 5.0) latencyColor = 'text-amber-600 dark:text-amber-400';
          else latencyColor = 'text-zinc-400';
        }

        rowsHtml += `
          <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors group">
            <td class="py-2.5 px-4 whitespace-nowrap">${renderStatusPill(item.status)}</td>
            <td class="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
              ${escapeHtml(item.name)}
            </td>
            <td class="py-2.5 px-4 font-mono text-xs">
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" 
                 class="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:underline break-all inline-flex items-center gap-1">
                ${escapeHtml(item.url)}
              </a>
            </td>
            <td class="py-2.5 px-4 text-right font-mono text-xs ${latencyColor} tabular-nums whitespace-nowrap">
              ${escapeHtml(item.time || '-')}
            </td>
            <td class="py-2.5 px-4">
              ${subcatBadge}${infoText || '<span class="text-zinc-400">-</span>'}
            </td>
            <td class="py-2.5 px-4 text-center">
              <button onclick="copyUrlToClipboard(this, '${escapeHtml(item.url)}')" title="Copy URL" 
                      class="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              </button>
            </td>
          </tr>
        `;
      }
    } else if (state.activeTab === 'issues') {
      for (const item of items) {
        const ghIssueUrl = `https://github.com/keiyoushi/extensions-source/issues/${item.pr_number}`;
        const labelsBadge = item.labels
          ? item.labels
              .split(',')
              .map(
                (lbl) =>
                  `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 mr-1 border border-zinc-200 dark:border-zinc-700">${escapeHtml(
                    lbl.trim()
                  )}</span>`
              )
              .join('')
          : '<span class="text-zinc-400">-</span>';

        const subcatBadge = item.subcategory
          ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 mr-1.5 border border-zinc-200 dark:border-zinc-700">${escapeHtml(
              item.subcategory
            )}</span>`
          : '';

        rowsHtml += `
          <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors group">
            <td class="py-2.5 px-4 whitespace-nowrap">${renderStatusPill(item.status)}</td>
            <td class="py-2.5 px-4 whitespace-nowrap font-mono text-xs">
              <a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                 class="font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:underline">
                #${item.pr_number}
              </a>
            </td>
            <td class="py-2.5 px-4 font-mono text-xs">
              ${
                item.url
                  ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" 
                        class="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:underline break-all inline-flex items-center gap-1">
                       ${escapeHtml(item.url)}
                     </a>`
                  : '<span class="text-zinc-400 italic">No URL extracted</span>'
              }
            </td>
            <td class="py-2.5 px-4 text-right font-mono text-xs text-zinc-400 tabular-nums whitespace-nowrap">
              ${escapeHtml(item.time || '-')}
            </td>
            <td class="py-2.5 px-4 whitespace-nowrap">${labelsBadge}</td>
            <td class="py-2.5 px-4">${subcatBadge}${escapeHtml(item.info) || '<span class="text-zinc-400">-</span>'}</td>
            <td class="py-2.5 px-4 text-center">
              ${
                item.url
                  ? `<button onclick="copyUrlToClipboard(this, '${escapeHtml(item.url)}')" title="Copy URL" 
                             class="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all">
                       <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                     </button>`
                  : ''
              }
            </td>
          </tr>
        `;
      }
    } else if (state.activeTab === 'map') {
      for (const item of items) {
        const ghIssueUrl = `https://github.com/keiyoushi/extensions-source/issues/${item.number}`;
        const hasMatches = item.matches && item.matches.length > 0;

        if (!hasMatches) {
          rowsHtml += `
            <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors">
              <td class="py-2.5 px-4 font-mono text-xs">
                <a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                   class="font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:underline block">
                  #${item.number}
                </a>
                <span class="text-zinc-500 text-xs font-sans">${escapeHtml(item.title)}</span>
              </td>
              <td class="py-2.5 px-4 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">${escapeHtml(item.source_name || '-')}</td>
              <td class="py-2.5 px-4">${renderStatusPill('🔍')}</td>
              <td class="py-2.5 px-4 text-zinc-400 italic font-mono text-xs">No match found</td>
              <td class="py-2.5 px-4 text-zinc-400">-</td>
              <td class="py-2.5 px-4 text-center text-zinc-400">-</td>
            </tr>
          `;
        } else {
          item.matches.forEach((m, idx) => {
            const scoreBadge = `<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono border border-zinc-200 dark:border-zinc-700 ml-1.5">${m.score}%</span>`;
            const methodsBadge = (m.methods || [])
              .map(
                (mth) =>
                  `<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-mono mr-1 border border-zinc-200 dark:border-zinc-700">${escapeHtml(
                    mth
                  )}</span>`
              )
              .join('');

            rowsHtml += `
              <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors group ${
                idx > 0 ? 'bg-zinc-50/20 dark:bg-zinc-900/20' : ''
              }">
                <td class="py-2.5 px-4 font-mono text-xs">
                  ${
                    idx === 0
                      ? `<a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                            class="font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:underline block">
                           #${item.number}
                         </a>
                         <span class="text-zinc-500 text-xs font-sans">${escapeHtml(item.title)}</span>`
                      : `<span class="text-zinc-400 pl-3 text-xs font-mono">↳ #${item.number}</span>`
                  }
                </td>
                <td class="py-2.5 px-4 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                  ${idx === 0 ? escapeHtml(item.source_name || '-') : ''}
                </td>
                <td class="py-2.5 px-4 whitespace-nowrap">${renderStatusPill(m.status)}</td>
                <td class="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  ${escapeHtml(m.name)}${scoreBadge}
                  <div class="mt-0.5">${methodsBadge}</div>
                </td>
                <td class="py-2.5 px-4 font-mono text-xs">
                  ${
                    m.url
                      ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" 
                            class="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:underline break-all inline-flex items-center gap-1">
                           ${escapeHtml(m.url)}
                         </a>`
                      : '<span class="text-zinc-400">-</span>'
                  }
                </td>
                <td class="py-2.5 px-4 text-center">
                  ${
                    m.url
                      ? `<button onclick="copyUrlToClipboard(this, '${escapeHtml(m.url)}')" title="Copy URL" 
                                 class="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all">
                           <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
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

    el.tableBody.innerHTML = rowsHtml;
  }

  // -------------------------------------------------------------
  // Pagination
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

    if (totalPages <= 1) {
      el.paginationButtons.innerHTML = '';
      return;
    }

    let btnHtml = '';

    // Prev
    btnHtml += `
      <button class="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-colors" 
              data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? 'disabled' : ''}>
        Prev
      </button>
    `;

    // Pages
    const maxBtns = 5;
    let startPage = Math.max(1, state.currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxBtns - 1);
    if (endPage - startPage + 1 < maxBtns) {
      startPage = Math.max(1, endPage - maxBtns + 1);
    }

    if (startPage > 1) {
      btnHtml += `<button class="w-7 h-7 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800" data-page="1">1</button>`;
      if (startPage > 2) btnHtml += `<span class="px-1 text-zinc-400">…</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      const active = p === state.currentPage;
      btnHtml += `
        <button class="w-7 h-7 rounded border transition-colors ${
          active
            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100 font-semibold'
            : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
        }" data-page="${p}">${p}</button>
      `;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) btnHtml += `<span class="px-1 text-zinc-400">…</span>`;
      btnHtml += `<button class="w-7 h-7 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next
    btnHtml += `
      <button class="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-colors" 
              data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? 'disabled' : ''}>
        Next
      </button>
    `;

    el.paginationButtons.innerHTML = btnHtml;

    el.paginationButtons.querySelectorAll('button[data-page]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = parseInt(b.dataset.page, 10);
        if (p && p !== state.currentPage) {
          state.currentPage = p;
          renderActiveTab();
          el.tableWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // -------------------------------------------------------------
  // Data Export (CSV & JSON)
  // -------------------------------------------------------------
  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`);
  }

  function exportFilteredData(format) {
    const items = getProcessedItems();
    const timestamp = new Date().toISOString().slice(0, 10);
    const baseName = `keiyoushi-${state.activeTab}-${timestamp}`;

    if (format === 'json') {
      const jsonContent = JSON.stringify(items, null, 2);
      downloadFile(jsonContent, `${baseName}.json`, 'application/json');
      return;
    }

    // CSV format
    let csvRows = [];
    if (state.activeTab === 'extensions') {
      csvRows.push(['Status', 'Name', 'URL', 'Time', 'Notes', 'Subcategory']);
      for (const it of items) {
        csvRows.push([it.status, it.name, it.url, it.time || '', it.info || '', it.subcategory || '']);
      }
    } else if (state.activeTab === 'issues') {
      csvRows.push(['Status', 'Issue', 'URL', 'Time', 'Labels', 'Info']);
      for (const it of items) {
        csvRows.push([it.status, `#${it.pr_number}`, it.url || '', it.time || '', it.labels || '', it.info || '']);
      }
    } else if (state.activeTab === 'map') {
      csvRows.push(['Issue', 'Source', 'Title', 'Matched_Extension', 'Status', 'Score', 'URL']);
      for (const it of items) {
        if (!it.matches || it.matches.length === 0) {
          csvRows.push([`#${it.number}`, it.source_name || '', it.title || '', '', 'No match', '', '']);
        } else {
          for (const m of it.matches) {
            csvRows.push([`#${it.number}`, it.source_name || '', it.title || '', m.name, m.status, `${m.score}%`, m.url || '']);
          }
        }
      }
    }

    const csvContent = csvRows
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      )
      .join('\n');

    downloadFile(csvContent, `${baseName}.csv`, 'text/csv;charset=utf-8;');
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
    renderFilterChips(data.results);

    const filtered = getProcessedItems();

    if (filtered.length === 0) {
      el.emptyState.classList.remove('hidden');
      el.tableWrapper.classList.add('hidden');
      renderPagination(0);
      return;
    }

    el.emptyState.classList.add('hidden');
    el.tableWrapper.classList.remove('hidden');

    renderTableHead();

    const isAll = state.pageSize === 'all';
    const pageSize = isAll ? filtered.length : parseInt(state.pageSize, 10);
    const startIdx = (state.currentPage - 1) * pageSize;
    const pageItems = isAll ? filtered : filtered.slice(startIdx, startIdx + pageSize);

    renderTableRows(pageItems);
    renderPagination(filtered.length);
  }

  // -------------------------------------------------------------
  // Tab Switching Function
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
          'tab-btn px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200/60 dark:border-zinc-700/60';
        const numBadge = btn.querySelector('span:first-child');
        if (numBadge) {
          numBadge.className =
            'w-4 h-4 rounded text-[10px] font-mono flex items-center justify-center bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-600';
        }
      } else {
        btn.className =
          'tab-btn px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200';
        const numBadge = btn.querySelector('span:first-child');
        if (numBadge) {
          numBadge.className =
            'w-4 h-4 rounded text-[10px] font-mono flex items-center justify-center bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400';
        }
      }
    });

    renderActiveTab();
  }

  // -------------------------------------------------------------
  // Events Setup
  // -------------------------------------------------------------
  function setupEvents() {
    // Tab Clicks
    el.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Search Input
    let timer;
    el.searchInput.addEventListener('input', (e) => {
      clearTimeout(timer);
      state.searchQuery = e.target.value;
      if (state.searchQuery) {
        el.clearSearchBtn.classList.remove('hidden');
      } else {
        el.clearSearchBtn.classList.add('hidden');
      }
      timer = setTimeout(() => {
        state.currentPage = 1;
        renderActiveTab();
      }, 120);
    });

    el.clearSearchBtn.addEventListener('click', () => {
      el.searchInput.value = '';
      state.searchQuery = '';
      el.clearSearchBtn.classList.add('hidden');
      state.currentPage = 1;
      renderActiveTab();
      el.searchInput.focus();
    });

    // Keyboard Shortcuts: 1, 2, 3, /, Esc, ⌘K
    window.addEventListener('keydown', (e) => {
      const isInputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

      if (!isInputActive) {
        if (e.key === '1') {
          e.preventDefault();
          switchTab('extensions');
        } else if (e.key === '2') {
          e.preventDefault();
          switchTab('issues');
        } else if (e.key === '3') {
          e.preventDefault();
          switchTab('map');
        }
      }

      if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !isInputActive) {
        e.preventDefault();
        el.searchInput.focus();
      } else if (e.key === 'Escape' && isInputActive) {
        el.searchInput.value = '';
        state.searchQuery = '';
        el.clearSearchBtn.classList.add('hidden');
        state.currentPage = 1;
        renderActiveTab();
        el.searchInput.blur();
      }
    });

    // Page Size Select
    el.pageSizeSelect.addEventListener('change', (e) => {
      state.pageSize = e.target.value;
      state.currentPage = 1;
      renderActiveTab();
    });

    // Reset button in empty state
    el.resetFiltersBtn.addEventListener('click', () => {
      el.searchInput.value = '';
      state.searchQuery = '';
      state.filterStatus = 'all';
      el.clearSearchBtn.classList.add('hidden');
      state.currentPage = 1;
      renderActiveTab();
    });

    // Export dropdown toggle
    el.exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      el.exportMenu.classList.add('hidden');
    });

    el.exportCsvBtn.addEventListener('click', () => {
      exportFilteredData('csv');
      el.exportMenu.classList.add('hidden');
    });

    el.exportJsonBtn.addEventListener('click', () => {
      exportFilteredData('json');
      el.exportMenu.classList.add('hidden');
    });
  }

  // -------------------------------------------------------------
  // Initial Boot
  // -------------------------------------------------------------
  initTheme();
  setupEvents();

  loadData('extensions').then(() => {
    renderActiveTab();
    loadData('issues');
    loadData('map');
  });
})();
