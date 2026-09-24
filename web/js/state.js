import { DATA_ENDPOINTS, STATUS_CONFIG, isOperationalSource } from './config.js';

const STATUS_RANK = {
  '✅': 1,
  '🔀': 2,
  '🚧': 3,
  '🛡️': 4,
  '⏳': 5,
  '⚠️': 6,
  '🛑': 7,
  '🔌': 8,
  '🅿️': 9,
  '🪧': 10,
  '🔍': 11,
  '❌': 12,
};

export const state = {
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

/**
 * Loads data for a given tab from endpoints or local cache.
 * @param {string} tab
 * @returns {Promise<Object|null>}
 */
export async function loadData(tab) {
  if (state.data[tab]) return state.data[tab];

  const endpoint = DATA_ENDPOINTS[tab];
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.data[tab] = json;
    return json;
  } catch (err) {
    console.error(`Failed to load ${tab} data:`, err);
    return null;
  }
}

/**
 * Filters and sorts raw data based on current state.
 * @returns {Array<Object>}
 */
export function getProcessedItems() {
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
      items = items.filter((item) => {
        const statusLabel = STATUS_CONFIG[item.status]?.label?.toLowerCase() || '';
        const isOp = isOperationalSource(item);
        const matchesOpQuery = (q === 'operational' || q === 'online') && isOp;
        return (
          matchesOpQuery ||
          (item.name && item.name.toLowerCase().includes(q)) ||
          (item.url && item.url.toLowerCase().includes(q)) ||
          (item.info && item.info.toLowerCase().includes(q)) ||
          (item.subcategory && item.subcategory.toLowerCase().includes(q)) ||
          statusLabel.includes(q)
        );
      });
    } else if (state.activeTab === 'issues') {
      items = items.filter((item) => {
        const statusLabel = STATUS_CONFIG[item.status]?.label?.toLowerCase() || '';
        return (
          (item.url && item.url.toLowerCase().includes(q)) ||
          String(item.pr_number).includes(q) ||
          (item.labels && item.labels.toLowerCase().includes(q)) ||
          (item.info && item.info.toLowerCase().includes(q)) ||
          (item.subcategory && item.subcategory.toLowerCase().includes(q)) ||
          statusLabel.includes(q)
        );
      });
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
                (m.methods && m.methods.some((mth) => mth.toLowerCase().includes(q))) ||
                (STATUS_CONFIG[m.status]?.label?.toLowerCase() || '').includes(q)
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
          valA = STATUS_RANK[a.status] || 99;
          valB = STATUS_RANK[b.status] || 99;
        }
      } else if (state.activeTab === 'issues') {
        if (col === 'number') {
          valA = a.pr_number || 0;
          valB = b.pr_number || 0;
        } else if (col === 'time') {
          valA = a.duration !== null && a.duration !== undefined ? a.duration : 9999;
          valB = b.duration !== null && b.duration !== undefined ? b.duration : 9999;
        } else if (col === 'status') {
          valA = STATUS_RANK[a.status] || 99;
          valB = STATUS_RANK[b.status] || 99;
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

/**
 * Handles header sort toggle state.
 * @param {string} col
 */
export function toggleSortColumn(col) {
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
}

/**
 * Resets search, status filter, and pagination back to defaults.
 */
export function resetStateFilters() {
  state.filterStatus = 'all';
  state.searchQuery = '';
  state.currentPage = 1;
  state.sortColumn = null;
  state.sortDirection = 'asc';
}
