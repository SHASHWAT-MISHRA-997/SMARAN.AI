import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * Two themes, both of them chosen.
 *
 * There was a third, "System Sync", which followed the operating system. It
 * meant light could arrive without anyone asking for it, and the app is not
 * uniformly themed - enough of it is painted with fixed dark colours that a
 * light page came out half and half. Following the OS into a state nobody
 * picked, and getting it wrong, is worse than not following it.
 *
 * Anyone who had it selected is moved to whichever they were actually looking
 * at, so the app does not change appearance under them on the way in.
 */

const ThemeContext = createContext();

export const applyThemeToDocument = (themeChoice) => {
  const root = window.document.documentElement;
  const isDark = themeChoice !== 'light';

  if (isDark) {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
  return isDark ? 'dark' : 'light';
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('theme') || localStorage.getItem('sm_appearance');
    if (saved === 'light' || saved === 'dark') return saved;
    // Was on "system", or on nothing. Keep whatever is on screen right now.
    const prefersLight = typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: light)').matches;
    return saved === 'system' && prefersLight ? 'light' : 'dark';
  });

  const setTheme = (newTheme) => {
    const next = newTheme === 'light' ? 'light' : 'dark';
    setThemeState(next);
    localStorage.setItem('theme', next);
    localStorage.setItem('sm_appearance', next);
    applyThemeToDocument(next);
    window.dispatchEvent(new CustomEvent('smaran:theme-change', { detail: { theme: next } }));
  };

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const isCurrentlyDark = theme !== 'light';

  const toggleTheme = () => {
    setTheme(isCurrentlyDark ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: isCurrentlyDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
