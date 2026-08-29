import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export const applyThemeToDocument = (themeChoice) => {
  const root = window.document.documentElement;
  const isDark =
    themeChoice === 'dark' ||
    (themeChoice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ||
    (!themeChoice && window.matchMedia('(prefers-color-scheme: dark)').matches);

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
    return saved && ['light', 'dark', 'system'].includes(saved) ? saved : 'dark';
  });

  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    localStorage.setItem('sm_appearance', newTheme);
    applyThemeToDocument(newTheme);
    window.dispatchEvent(new CustomEvent('smaran:theme-change', { detail: { theme: newTheme } }));
  };

  useEffect(() => {
    applyThemeToDocument(theme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (theme === 'system') {
        applyThemeToDocument('system');
      }
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
  }, [theme]);

  const isCurrentlyDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

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

