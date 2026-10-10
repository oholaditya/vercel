import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
const KEY = 'vertex.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'light'; // light is the default, matching the program guide
}

function resolve(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Apply before React renders to avoid a flash of the wrong theme. */
export function bootstrapTheme() {
  document.documentElement.setAttribute('data-theme', resolve(readPref()));
}

const ThemeCtx = createContext<{ pref: ThemePref; theme: 'dark' | 'light'; setPref: (p: ThemePref) => void; toggle: () => void } | null>(
  null,
);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => resolve(readPref()));

  useEffect(() => {
    const apply = () => {
      const t = resolve(pref);
      setTheme(t);
      document.documentElement.setAttribute('data-theme', t);
    };
    apply();
    if (pref !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => setPref(theme === 'dark' ? 'light' : 'dark'), [theme, setPref]);

  return <ThemeCtx.Provider value={{ pref, theme, setPref, toggle }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
