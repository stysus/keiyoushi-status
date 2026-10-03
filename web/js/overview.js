// Keiyoushi Status Dashboard - Hero overview, tab badges, and 30-day trend.

import { getTierCategory } from './config.js';
import { formatRelativeTime } from './utils.js';
import { renderSparkline } from './components.js';
import { state, loadData } from './state.js';

/**
 * Renders the hero status headline, proportion bar, and metric strip.
 * @param {Object} el Cached DOM elements.
 */
export function updateHeroOverview(el) {
  const ext = state.data.extensions;
  if (!ext || !ext.results) return;

  const list = ext.results;
  const total = list.length;
  let pureOk = 0;
  let challenge = 0;
  let degraded = 0;
  let offline = 0;

  for (const item of list) {
    const tier = getTierCategory(item);
    if (tier === 'operational_pure') pureOk++;
    else if (tier === 'protection_challenge') challenge++;
    else if (tier === 'degraded_notice') degraded++;
    else offline++;
  }

  el.statTotal.textContent = total.toLocaleString();
  el.statOk.textContent = pureOk.toLocaleString();
  el.statChallenge.textContent = challenge.toLocaleString();
  el.statDegraded.textContent = degraded.toLocaleString();
  el.statOffline.textContent = offline.toLocaleString();

  // Percentages for status bar
  const pOk = total > 0 ? (pureOk / total) * 100 : 0;
  const pChallenge = total > 0 ? (challenge / total) * 100 : 0;
  const pDegraded = total > 0 ? (degraded / total) * 100 : 0;
  const pOffline = total > 0 ? (offline / total) * 100 : 0;

  el.barOk.style.width = `${pOk}%`;
  el.barChallenge.style.width = `${pChallenge}%`;
  el.barDegraded.style.width = `${pDegraded}%`;
  el.barOffline.style.width = `${pOffline}%`;

  // Comprehensive Operational Headline (Pure OK + Challenge/WAF/Same-Auth)
  const totalOperational = pureOk + challenge;
  const pOperational = total > 0 ? (totalOperational / total) * 100 : 0;
  const percentage = pOperational.toFixed(1);
  el.heroStatusText.innerHTML = `<span>${percentage}% Sources Operational</span>`;

  if (pOperational >= 90) {
    el.heroPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
    el.heroDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-emerald-500';
  } else if (pOperational >= 75) {
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

/**
 * Updates the per-tab record counts.
 * @param {Object} el Cached DOM elements.
 */
export function updateTabBadges(el) {
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

/**
 * Renders the 30-day operational-share sparkline.
 * @param {Object} el Cached DOM elements.
 */
export async function updateTrend(el) {
  let history;
  try {
    history = await loadData('history');
  } catch {
    return;
  }
  if (!history || !Array.isArray(history.days) || history.days.length < 2) return;

  const recent = history.days.slice(-30);
  const pct = recent.map((d) => (d.total ? (d.operational / d.total) * 100 : 0));

  el.trendSparkline.innerHTML = renderSparkline(pct);
  const last = pct[pct.length - 1];
  const delta = last - pct[0];
  el.trendValue.textContent = `${last.toFixed(1)}%`;
  el.trendValue.className = `font-semibold tabular-nums ${
    delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
  }`;
  el.trendContainer.title = `Operational ${pct[0].toFixed(1)}% → ${last.toFixed(1)}% over ${recent.length} days`;
  el.trendContainer.classList.remove('hidden');
  el.trendContainer.classList.add('inline-flex');
}
