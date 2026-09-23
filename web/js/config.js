// Keiyoushi Status Dashboard - Configuration & Constants

export const STATUS_CONFIG = {
  '✅': { label: 'Operational', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  '🔀': { label: 'Redirect', dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/25' },
  '🚧': { label: 'IUAM', dot: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/25' },
  '🛑': { label: 'Blocked', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/25' },
  '🅿️': { label: 'Parked', dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-500/10', border: 'border-purple-500/25' },
  '🪧': { label: 'Placeholder', dot: 'bg-cyan-500', text: 'text-cyan-800 dark:text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/25' },
  '⚠️': { label: 'Warning', dot: 'bg-yellow-500', text: 'text-yellow-800 dark:text-yellow-300', bg: 'bg-yellow-500/10', border: 'border-yellow-500/25' },
  '❌': { label: 'Error', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-300', bg: 'bg-red-500/10', border: 'border-red-500/25' },
  '🔍': { label: 'Not Found', dot: 'bg-zinc-500', text: 'text-zinc-700 dark:text-zinc-300', bg: 'bg-zinc-500/10', border: 'border-zinc-500/25' },
};

export const DATA_ENDPOINTS = {
  extensions: 'data/extensions.json',
  issues: 'data/issues.json',
  map: 'data/issue_map.json',
};

export const GITHUB_BASE_URL = 'https://github.com/keiyoushi/extensions-source';
