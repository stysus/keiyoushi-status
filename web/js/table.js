import { GITHUB_BASE_URL } from './config.js';
import { escapeHtml } from './utils.js';
import { renderStatusPill, renderStatusCell, renderBadge, renderCopyButton } from './components.js';

/**
 * Generates the sorting indicator arrow.
 * @param {string} col
 * @param {string|null} sortColumn
 * @param {'asc'|'desc'} sortDirection
 * @returns {string}
 */
export function getSortIndicator(col, sortColumn, sortDirection) {
  if (sortColumn !== col) return `<span class="opacity-40 ml-1 text-zinc-500">↕</span>`;
  return sortDirection === 'asc'
    ? `<span class="text-zinc-950 dark:text-white font-bold ml-1">↑</span>`
    : `<span class="text-zinc-950 dark:text-white font-bold ml-1">↓</span>`;
}

/**
 * Returns latency styling class based on duration in seconds.
 * @param {number|null|undefined} duration
 * @returns {string}
 */
function getLatencyColorClass(duration) {
  if (duration === null || duration === undefined) return 'text-zinc-600 dark:text-zinc-400 font-semibold';
  if (duration < 2.0) return 'text-emerald-700 dark:text-emerald-400 font-semibold';
  if (duration < 5.0) return 'text-amber-800 dark:text-amber-400 font-semibold';
  return 'text-zinc-600 dark:text-zinc-400 font-semibold';
}

/**
 * Generates table header HTML based on the active tab and sort state.
 * @param {string} activeTab
 * @param {string|null} sortColumn
 * @param {'asc'|'desc'} sortDirection
 * @returns {string}
 */
export function renderTableHead(activeTab, sortColumn, sortDirection) {
  if (activeTab === 'extensions') {
    return `
      <tr>
        <th class="py-2.5 px-4 w-36 cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="status">
          STATUS ${getSortIndicator('status', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="name">
          EXTENSION ${getSortIndicator('name', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 font-semibold">URL</th>
        <th class="py-2.5 px-4 w-28 text-right cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="time">
          LATENCY ${getSortIndicator('time', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 font-semibold">NOTES / CATEGORY</th>
        <th class="py-2.5 px-4 w-12 text-center font-semibold"></th>
      </tr>
    `;
  }

  if (activeTab === 'issues') {
    return `
      <tr>
        <th class="py-2.5 px-4 w-36 cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="status">
          STATUS ${getSortIndicator('status', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 w-28 cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="number">
          ISSUE ${getSortIndicator('number', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 font-semibold">URL</th>
        <th class="py-2.5 px-4 w-28 text-right cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="time">
          LATENCY ${getSortIndicator('time', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 font-semibold">LABELS</th>
        <th class="py-2.5 px-4 font-semibold">INFO</th>
        <th class="py-2.5 px-4 w-12 text-center font-semibold"></th>
      </tr>
    `;
  }

  if (activeTab === 'map') {
    return `
      <tr>
        <th class="py-2.5 px-4 w-36 cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="number">
          BUG ISSUE ${getSortIndicator('number', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 cursor-pointer hover:text-zinc-950 dark:hover:text-white transition-colors" data-sort="source">
          SOURCE ${getSortIndicator('source', sortColumn, sortDirection)}
        </th>
        <th class="py-2.5 px-4 w-36 font-semibold">STATUS</th>
        <th class="py-2.5 px-4 font-semibold">MATCHED EXTENSION</th>
        <th class="py-2.5 px-4 font-semibold">TARGET URL</th>
        <th class="py-2.5 px-4 w-12 text-center font-semibold"></th>
      </tr>
    `;
  }

  return '';
}

/**
 * Renders the Notes / Category cell with clean inline-flex layout and sanitization.
 * @param {string} subcategory
 * @param {string} info
 * @returns {string}
 */
export function renderNotesCell(subcategory, info) {
  let displayInfo = (info || '').trim();

  // Strip trailing colons e.g. "HTTP 202:" or "Few nodes (13). HTTP 202:"
  displayInfo = displayInfo.replace(/:\s*$/, '').trim();

  // If subcategory is present, clean redundant prefixes/duplicates from info
  if (subcategory && displayInfo) {
    const subcatLower = subcategory.toLowerCase();

    // If Cloudflare 52x, title is usually boilerplate e.g. "HTTP 525: domain.com | 525: SSL handshake failed"
    if (subcatLower.startsWith('cloudflare') && displayInfo.includes('|')) {
      displayInfo = '';
    } else if (subcatLower === displayInfo.toLowerCase() || subcatLower.includes(displayInfo.toLowerCase())) {
      displayInfo = '';
    } else {
      // Strip redundant status code e.g. "Few nodes (13). HTTP 403: " or "HTTP 403: "
      displayInfo = displayInfo.replace(/^(?:Few nodes \(\d+\)\.\s*)?(?:HTTP\s*)?\d{3}\s*[:\s-]\s*/i, '').trim();
      displayInfo = displayInfo.replace(/:\s*$/, '').trim();
      if (subcatLower.includes(displayInfo.toLowerCase())) {
        displayInfo = '';
      }
    }
  }

  const subcatBadge = subcategory ? renderBadge(subcategory) : '';
  const infoText = displayInfo
    ? `<span class="text-xs text-zinc-600 dark:text-zinc-300 font-normal leading-relaxed">${escapeHtml(displayInfo)}</span>`
    : '';

  if (subcatBadge && infoText) {
    return `<div class="inline-flex flex-wrap items-center gap-2">${subcatBadge}${infoText}</div>`;
  }
  if (subcatBadge) {
    return `<div class="inline-flex items-center">${subcatBadge}</div>`;
  }
  if (infoText) {
    return infoText;
  }
  return '<span class="text-zinc-400 dark:text-zinc-500 font-mono">-</span>';
}

/**
 * Renders table body rows based on the current items and tab.
 * @param {Array<Object>} items
 * @param {string} activeTab
 * @returns {string}
 */
export function renderTableRows(items, activeTab) {
  let rowsHtml = '';

  if (activeTab === 'extensions') {
    for (const item of items) {
      const latencyColor = getLatencyColorClass(item.duration);

      rowsHtml += `
        <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors group">
          <td class="py-2.5 px-4 whitespace-nowrap">${renderStatusCell(item)}</td>
          <td class="py-2.5 px-4 font-medium text-zinc-950 dark:text-white whitespace-nowrap">
            ${escapeHtml(item.name)}
          </td>
          <td class="py-2.5 px-4 font-mono text-xs">
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" 
               class="text-zinc-700 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white hover:underline break-all inline-flex items-center gap-1 font-normal">
              ${escapeHtml(item.url)}
            </a>
          </td>
          <td class="py-2.5 px-4 text-right font-mono text-xs ${latencyColor} tabular-nums whitespace-nowrap">
            ${escapeHtml(item.time || '-')}
          </td>
          <td class="py-2.5 px-4">
            ${renderNotesCell(item.subcategory, item.info)}
          </td>
          <td class="py-2.5 px-4 text-center">
            ${renderCopyButton(item.url)}
          </td>
        </tr>
      `;
    }
  } else if (activeTab === 'issues') {
    for (const item of items) {
      const ghIssueUrl = `${GITHUB_BASE_URL}/issues/${item.pr_number}`;
      const labelsBadge = item.labels
        ? item.labels
            .split(',')
            .map((lbl) => renderBadge(lbl.trim()))
            .join('')
        : '<span class="text-zinc-400 dark:text-zinc-500 font-mono">-</span>';

      rowsHtml += `
        <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors group">
          <td class="py-2.5 px-4 whitespace-nowrap">${renderStatusCell(item)}</td>
          <td class="py-2.5 px-4 whitespace-nowrap font-mono text-xs">
            <a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
               class="font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white hover:underline">
              #${item.pr_number}
            </a>
          </td>
          <td class="py-2.5 px-4 font-mono text-xs">
            ${
              item.url
                ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" 
                      class="text-zinc-700 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white hover:underline break-all inline-flex items-center gap-1 font-normal">
                     ${escapeHtml(item.url)}
                   </a>`
                : '<span class="text-zinc-500 italic">No URL extracted</span>'
            }
          </td>
          <td class="py-2.5 px-4 text-right font-mono text-xs text-zinc-600 dark:text-zinc-400 tabular-nums whitespace-nowrap font-medium">
            ${escapeHtml(item.time || '-')}
          </td>
          <td class="py-2.5 px-4 whitespace-nowrap">${labelsBadge}</td>
          <td class="py-2.5 px-4">
            ${renderNotesCell(item.subcategory, item.info)}
          </td>
          <td class="py-2.5 px-4 text-center">
            ${renderCopyButton(item.url)}
          </td>
        </tr>
      `;
    }
  } else if (activeTab === 'map') {
    for (const item of items) {
      const ghIssueUrl = `${GITHUB_BASE_URL}/issues/${item.number}`;
      const hasMatches = item.matches && item.matches.length > 0;

      if (!hasMatches) {
        rowsHtml += `
          <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors">
            <td class="py-2.5 px-4 font-mono text-xs">
              <a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                 class="font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white hover:underline block">
                #${item.number}
              </a>
              <span class="text-zinc-600 dark:text-zinc-400 text-xs font-sans">${escapeHtml(item.title)}</span>
            </td>
            <td class="py-2.5 px-4 text-zinc-700 dark:text-zinc-300 font-medium whitespace-nowrap">${escapeHtml(item.source_name || '-')}</td>
            <td class="py-2.5 px-4">${renderStatusPill('🔍')}</td>
            <td class="py-2.5 px-4 text-zinc-500 italic font-mono text-xs">No match found</td>
            <td class="py-2.5 px-4 text-zinc-400 font-mono">-</td>
            <td class="py-2.5 px-4 text-center text-zinc-400 font-mono">-</td>
          </tr>
        `;
      } else {
        item.matches.forEach((m, idx) => {
          const scoreBadge = renderBadge(`${m.score}%`, 'score');
          const methodsBadge = (m.methods || []).map((mth) => renderBadge(mth, 'method')).join('');

          rowsHtml += `
            <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-850/60 transition-colors group ${
              idx > 0 ? 'bg-zinc-50/20 dark:bg-zinc-900/20' : ''
            }">
              <td class="py-2.5 px-4 font-mono text-xs">
                ${
                  idx === 0
                    ? `<a href="${ghIssueUrl}" target="_blank" rel="noopener noreferrer" 
                          class="font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white hover:underline block">
                         #${item.number}
                       </a>
                       <span class="text-zinc-600 dark:text-zinc-400 text-xs font-sans">${escapeHtml(item.title)}</span>`
                    : `<span class="text-zinc-500 pl-3 text-xs font-mono">↳ #${item.number}</span>`
                }
              </td>
              <td class="py-2.5 px-4 text-zinc-700 dark:text-zinc-300 font-medium whitespace-nowrap">
                ${idx === 0 ? escapeHtml(item.source_name || '-') : ''}
              </td>
              <td class="py-2.5 px-4 whitespace-nowrap">${renderStatusCell(m)}</td>
              <td class="py-2.5 px-4 font-semibold text-zinc-950 dark:text-white whitespace-nowrap">
                ${escapeHtml(m.name)}${scoreBadge}
                <div class="mt-0.5">${methodsBadge}</div>
              </td>
              <td class="py-2.5 px-4 font-mono text-xs">
                ${
                  m.url
                    ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" 
                          class="text-zinc-700 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white hover:underline break-all inline-flex items-center gap-1 font-normal">
                         ${escapeHtml(m.url)}
                       </a>`
                    : '<span class="text-zinc-400 dark:text-zinc-500 font-mono">-</span>'
                }
              </td>
              <td class="py-2.5 px-4 text-center">
                ${renderCopyButton(m.url)}
              </td>
            </tr>
          `;
        });
      }
    }
  }

  return rowsHtml;
}
