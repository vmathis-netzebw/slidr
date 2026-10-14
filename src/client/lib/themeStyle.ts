import type { CSSProperties } from 'react';
import { DEFAULT_THEME, contrastText, isDarkColor, type Theme } from '../../shared/theme.js';

/** Setzt die CSS-Variablen des Farbschemas auf einem Container. */
export function themeStyle(theme: Theme | undefined): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    '--accent': theme.primary,
    '--on-accent': contrastText(theme.primary),
    '--accent-dark': theme.secondary,
    '--tertiary': theme.tertiary,
  } as CSSProperties;
}

/**
 * Präsentationsansicht: Eine dunkle Primärfarbe (z.B. EnBW-Blau) wird zum Folien-
 * Hintergrund, Buttons nehmen dann die Sekundärfarbe – sonst wären sie unsichtbar.
 */
export function presenterThemeStyle(theme: Theme | undefined): CSSProperties | undefined {
  const t = theme ?? DEFAULT_THEME;
  if (!isDarkColor(t.primary)) return themeStyle(theme);
  return {
    ...themeStyle(t),
    '--accent': t.secondary,
    '--on-accent': contrastText(t.secondary),
    '--dark-bg': t.primary,
    '--dark-panel': `color-mix(in srgb, ${t.primary} 88%, #ffffff)`,
    '--dark-text': '#ffffff',
    '--dark-muted': `color-mix(in srgb, ${t.primary} 30%, #ffffff)`,
  } as CSSProperties;
}
