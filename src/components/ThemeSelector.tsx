import { useState } from 'react';
import { applyTheme, getStoredTheme, storeTheme, type Theme } from '../theme/theme';

const LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

export default function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const change = (t: Theme) => { setTheme(t); storeTheme(t); applyTheme(t); };
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      Theme
      <select
        value={theme}
        onChange={(e) => change(e.target.value as Theme)}
        className="rounded border border-slate-300 bg-transparent px-1 py-1 text-sm text-slate-900 dark:border-slate-600 dark:text-slate-100"
      >
        {(Object.keys(LABELS) as Theme[]).map((t) => <option key={t} value={t} className="text-slate-900">{LABELS[t]}</option>)}
      </select>
    </label>
  );
}