// Keiyoushi Status Dashboard - Theme Management

const THEME_STORAGE_KEY = 'keiyoushi-theme';

/**
 * Initializes theme state and listeners.
 * @param {HTMLElement} themeToggleBtn
 * @param {HTMLElement} sunIcon
 * @param {HTMLElement} moonIcon
 */
export function initTheme(themeToggleBtn, sunIcon, moonIcon) {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;

  applyTheme(isDark, sunIcon, moonIcon);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const willBeDark = !document.documentElement.classList.contains('dark');
      applyTheme(willBeDark, sunIcon, moonIcon);
      localStorage.setItem(THEME_STORAGE_KEY, willBeDark ? 'dark' : 'light');
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_STORAGE_KEY)) {
      applyTheme(e.matches, sunIcon, moonIcon);
    }
  });
}

/**
 * Applies the dark or light class to html element and updates toggle icons.
 * @param {boolean} isDark
 * @param {HTMLElement} [sunIcon]
 * @param {HTMLElement} [moonIcon]
 */
export function applyTheme(isDark, sunIcon, moonIcon) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    if (sunIcon) sunIcon.classList.remove('hidden');
    if (moonIcon) moonIcon.classList.add('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    if (sunIcon) sunIcon.classList.add('hidden');
    if (moonIcon) moonIcon.classList.remove('hidden');
  }
}
