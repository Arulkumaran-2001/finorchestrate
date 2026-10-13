import { useEffect, useState, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'finorchestrate.theme';

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(preference: ThemePreference): void {
  if (preference === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
}

export function useTheme(): { preference: ThemePreference; resolved: 'light' | 'dark'; setPreference: (value: ThemePreference) => void } {
  const [preference, setState] = useState<ThemePreference>(readPreference);
  const systemDark = useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => applyTheme(preference), [preference]);
  return {
    preference,
    resolved: preference === 'system' ? (systemDark ? 'dark' : 'light') : preference,
    setPreference: (value) => {
      try {
        if (value === 'system') window.localStorage.removeItem(KEY);
        else window.localStorage.setItem(KEY, value);
      } catch {
        // Storage can be unavailable in private windows; the choice still applies for this visit.
      }
      setState(value);
    },
  };
}
