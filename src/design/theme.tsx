/**
 * Theme access.
 *
 * Follows the OS setting. A manual override lands in Phase 7 with the rest of
 * the settings screen; the shape here already supports it, so that will be a
 * store read rather than a refactor.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { palette, type Palette, type ThemeName } from './tokens';

interface Theme {
  readonly name: ThemeName;
  readonly colors: Palette;
  readonly isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const name: ThemeName = scheme === 'dark' ? 'dark' : 'light';

  const value = useMemo<Theme>(
    () => ({ name, colors: palette[name], isDark: name === 'dark' }),
    [name],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return theme;
}

/** Shorthand for the common case of only wanting colours. */
export function useColors(): Palette {
  return useTheme().colors;
}
