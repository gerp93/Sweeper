import React, { createContext, useContext, useEffect, useState } from 'react';
import { Theme, AVAILABLE_THEMES, getStoredTheme, saveTheme, applyTheme } from '../utils/themes';

interface ThemeContextType {
  currentTheme: Theme | null;
  setTheme: (theme: Theme | null) => void;
  availableThemes: typeof AVAILABLE_THEMES;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Theme | null>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const handleSetTheme = (theme: Theme | null) => {
    setCurrentTheme(theme);
    saveTheme(theme || AVAILABLE_THEMES[0]);
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme: handleSetTheme, availableThemes: AVAILABLE_THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
