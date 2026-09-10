import React, { createContext, useContext, useEffect, useState } from 'react';
import { applyAppearance, loadAppearance } from '../utils/appearancePreferences';

/**
 * Three themes: light, dark, and system.
 *
 * "System" was removed once and has been put back. The reason it was removed
 * still matters: the app is painted in places with fixed dark colours, so a
 * light page could come out half and half, and system meant arriving there
 * without anyone choosing it. What makes it safe to offer again is that the
 * surfaces now come from `--color-*` tokens in index.css that flip with the
 * class set below, plus the `.theme-system` overrides for the parts not yet
 * migrated. If you add a fixed `bg-zinc-900` or `text-white` to a component,
 * you are re-creating that bug for every system-theme user on a light desktop.
 *
 * Three classes are managed here, and all three matter: `dark` drives the
 * Tailwind `dark:` variant, `light` is what `.light.theme-system` keys off,
 * and `theme-system` marks that the choice came from the OS rather than the
 * user - which is why it is removed on an explicit pick.
 */

const ThemeContext = createContext();

export const applyThemeToDocument = (themeChoice) => {
  const root = window.document.documentElement;
  
  if (themeChoice === 'system') {
    const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add('theme-system');
    if (prefersDark) {
      root.classList.add('dark');
      root.classList.remove('light');
      root.style.colorScheme = 'dark';
      return 'dark';
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      root.style.colorScheme = 'light';
      return 'light';
    }
  }

  root.classList.remove('theme-system');
  if (themeChoice === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
    return 'light';
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
    return 'dark';
  }
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('theme') || localStorage.getItem('sm_appearance');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'dark';
  });

  const setTheme = (newTheme) => {
    const next = newTheme === 'light' ? 'light' : newTheme === 'system' ? 'system' : 'dark';
    setThemeState(next);
    localStorage.setItem('theme', next);
    localStorage.setItem('sm_appearance', next);
    applyThemeToDocument(next);
    window.dispatchEvent(new CustomEvent('smaran:theme-change', { detail: { theme: next } }));
  };

  useEffect(() => {
    applyThemeToDocument(theme);
    applyAppearance(loadAppearance());

    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        applyThemeToDocument('system');
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  const isCurrentlyDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

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
