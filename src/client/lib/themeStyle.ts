import type { CSSProperties } from 'react';
import { contrastText, type Theme } from '../../shared/theme.js';

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
