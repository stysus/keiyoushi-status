// Keiyoushi Status Dashboard - CSV and JSON Data Exporter

import { downloadFile } from './utils.js';

/**
 * Exports processed data items to either CSV or JSON format.
 * @param {string} activeTab
 * @param {Array<Object>} items
 * @param {'csv'|'json'} format
 * @param {Function} [onSuccess]
 */
export function exportFilteredData(activeTab, items, format, onSuccess) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const baseName = `keiyoushi-${activeTab}-${timestamp}`;

  if (format === 'json') {
    const jsonContent = JSON.stringify(items, null, 2);
    const fileName = `${baseName}.json`;
    downloadFile(jsonContent, fileName, 'application/json');
    if (onSuccess) onSuccess(fileName);
    return;
  }

  // CSV format
  const csvRows = [];
  if (activeTab === 'extensions') {
    csvRows.push(['Status', 'Name', 'URL', 'Time', 'Notes', 'Subcategory']);
    for (const it of items) {
      csvRows.push([it.status, it.name, it.url, it.time || '', it.info || '', it.subcategory || '']);
    }
  } else if (activeTab === 'issues') {
    csvRows.push(['Status', 'Issue', 'URL', 'Time', 'Labels', 'Info']);
    for (const it of items) {
      csvRows.push([it.status, `#${it.pr_number}`, it.url || '', it.time || '', it.labels || '', it.info || '']);
    }
  } else if (activeTab === 'map') {
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

  const fileName = `${baseName}.csv`;
  downloadFile(csvContent, fileName, 'text/csv;charset=utf-8;');
  if (onSuccess) onSuccess(fileName);
}
