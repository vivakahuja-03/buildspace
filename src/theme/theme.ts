export type Theme = 'light' | 'dark' | 'system';
export const THEME_KEY = 'buildspace-theme';
export const THEMES: Theme[] = ['light', 'dark', 'system'];

export function getStoredTheme(): Theme {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

const prefersDark = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Adds/removes the `dark` class on <html> (Tailwind darkMode: 'class') and sets the native colour scheme. */
export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export function storeTheme(theme: Theme): void {
  try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable: theme still applies for this session */ }
}

/** Call once before first render. Also follows OS changes while the choice is "system". */
export function initTheme(): void {
  applyTheme(getStoredTheme());
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (getStoredTheme() === 'system') applyTheme('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
}