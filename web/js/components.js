// Keiyoushi Status Dashboard - Reusable UI Components

import { STATUS_CONFIG } from './config.js';
import { escapeHtml } from './utils.js';

/**
 * Renders a high-contrast semantic status pill.
 * @param {string} statusEmoji
 * @returns {string}
 */
export function renderStatusPill(statusEmoji) {
  const conf = STATUS_CONFIG[statusEmoji] || {
    label: statusEmoji || 'Unknown',
    dot: 'bg-zinc-500',
    text: 'text-zinc-700 dark:text-zinc-300',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/25',
  };

  return `
    <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold font-mono ${conf.bg} ${conf.text} border ${conf.border}">
      <span class="w-1.5 h-1.5 rounded-full ${conf.dot}"></span>
      <span>${conf.label}</span>
    </span>
  `;
}

/**
 * Renders a standardized badge (subcategory, label, score, method).
 * @param {string} text
 * @param {'neutral'|'score'|'method'} [variant='neutral']
 * @returns {string}
 */
export function renderBadge(text, variant = 'neutral') {
  if (!text) return '';
  const escaped = escapeHtml(text);

  if (variant === 'score') {
    return `<span class="inline-block px-1.5 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono border border-zinc-300 dark:border-zinc-700 font-medium ml-1.5">${escaped}</span>`;
  }
  if (variant === 'method') {
    return `<span class="inline-block px-1.5 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono mr-1 border border-zinc-200 dark:border-zinc-700">${escaped}</span>`;
  }
  return `<span class="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 mr-1.5 border border-zinc-300 dark:border-zinc-700 font-medium">${escaped}</span>`;
}

/**
 * Renders an accessible copy button with data-copy-url attribute for event delegation.
 * @param {string} url
 * @returns {string}
 */
export function renderCopyButton(url) {
  if (!url) return '';
  const escaped = escapeHtml(url);
  return `
    <button type="button" data-copy-url="${escaped}" title="Copy URL"
            class="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-all cursor-pointer">
      <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
      </svg>
    </button>
  `;
}

/**
 * Generates filter chip buttons HTML based on item statuses.
 * @param {Array<Object>} items
 * @param {string} currentFilter
 * @param {string} activeTab
 * @returns {string}
 */
export function renderFilterChips(items, currentFilter, activeTab) {
  const counts = { all: items.length };
  for (const item of items) {
    let status = item.status;
    if (activeTab === 'map') {
      status = item.matches && item.matches.length > 0 ? item.matches[0].status : '🔍';
    }
    counts[status] = (counts[status] || 0) + 1;
  }

  let chipsHtml = `
    <button type="button" class="filter-chip px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors flex items-center gap-1.5 cursor-pointer ${
      currentFilter === 'all'
        ? 'bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-100 dark:text-zinc-950 dark:border-white shadow-sm font-semibold'
        : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600'
    }" data-status="all">
      <span>All</span>
      <span class="text-xs px-1.5 py-0.5 rounded font-medium ${
        currentFilter === 'all' ? 'bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
      }">${counts.all}</span>
    </button>
  `;

  for (const [emoji, conf] of Object.entries(STATUS_CONFIG)) {
    if (!counts[emoji]) continue;
    const isActive = currentFilter === emoji;
    chipsHtml += `
      <button type="button" class="filter-chip px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors flex items-center gap-1.5 cursor-pointer ${
        isActive
          ? 'bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-100 dark:text-zinc-950 dark:border-white shadow-sm font-semibold'
          : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600'
      }" data-status="${emoji}">
        <span class="w-1.5 h-1.5 rounded-full ${conf.dot}"></span>
        <span>${conf.label}</span>
        <span class="text-xs px-1.5 py-0.5 rounded font-medium ${
          isActive ? 'bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
        }">${counts[emoji]}</span>
      </button>
    `;
  }

  return chipsHtml;
}

/**
 * Generates pagination control buttons HTML.
 * @param {number} currentPage
 * @param {number} totalPages
 * @returns {string}
 */
export function renderPaginationButtons(currentPage, totalPages) {
  if (totalPages <= 1) return '';

  let btnHtml = '';

  // Prev Button
  btnHtml += `
    <button type="button" class="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-colors text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer" 
            data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>
      Prev
    </button>
  `;

  const maxBtns = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxBtns - 1);
  if (endPage - startPage + 1 < maxBtns) {
    startPage = Math.max(1, endPage - maxBtns + 1);
  }

  if (startPage > 1) {
    btnHtml += `<button type="button" class="w-7 h-7 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer" data-page="1">1</button>`;
    if (startPage > 2) btnHtml += `<span class="px-1 text-zinc-500 font-medium">…</span>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    const active = p === currentPage;
    btnHtml += `
      <button type="button" class="w-7 h-7 rounded border transition-colors cursor-pointer ${
        active
          ? 'bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-100 dark:text-zinc-950 dark:border-white font-bold shadow-sm'
          : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium'
      }" data-page="${p}">${p}</button>
    `;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) btnHtml += `<span class="px-1 text-zinc-500 font-medium">…</span>`;
    btnHtml += `<button type="button" class="w-7 h-7 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer" data-page="${totalPages}">${totalPages}</button>`;
  }

  // Next Button
  btnHtml += `
    <button type="button" class="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-colors text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer" 
            data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>
      Next
    </button>
  `;

  return btnHtml;
}

let toastTimeout;
/**
 * Displays a non-blocking toast message.
 * @param {HTMLElement} toastEl
 * @param {HTMLElement} toastMsgEl
 * @param {string} message
 */
export function showToast(toastEl, toastMsgEl, message) {
  if (!toastEl || !toastMsgEl) return;
  toastMsgEl.textContent = message;
  toastEl.classList.remove('translate-y-8', 'opacity-0');
  toastEl.classList.add('translate-y-0', 'opacity-100');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('translate-y-0', 'opacity-100');
    toastEl.classList.add('translate-y-8', 'opacity-0');
  }, 1800);
}
