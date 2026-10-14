/** CI-Farbschema für Umfragen und Feedback-Bögen. */
export interface Theme {
  /** Buttons, Auswahl, Slider, Balken. */
  primary: string;
  /** Verteilungskurve und Kennzahlen auf der Präsentationsansicht. */
  secondary: string;
  /** Hervorhebungen wie die Durchschnittslinie. */
  tertiary: string;
  /** ID eines hochgeladenen Logos (siehe `logoUrl`). */
  logo?: string;
}

export const THEME_KEYS = ['primary', 'secondary', 'tertiary'] as const;
export type ThemeColorKey = (typeof THEME_KEYS)[number];

export const LOGO_MAX_BYTES = 512 * 1024;
/** Inhaltsadressiert: sha256-Präfix plus Dateiendung. */
export const LOGO_ID_PATTERN = /^[0-9a-f]{32}\.(?:png|jpg|gif|webp|svg)$/;

export function logoUrl(id: string): string {
  return `/api/logos/${id}`;
}

export const THEME_LABELS: Record<ThemeColorKey, string> = {
  primary: 'Primärfarbe',
  secondary: 'Sekundärfarbe',
  tertiary: 'Tertiärfarbe',
};

/** EnBW-CI: Dunkelblau, Orange, Gelb. */
export const DEFAULT_THEME: Theme = {
  primary: '#000099',
  secondary: '#ff9900',
  tertiary: '#ffdd00',
};

/** Standardfarben vor der Umstellung auf EnBW-CI (für gespeicherte Altwerte). */
export const LEGACY_DEFAULT_THEME: Theme = {
  primary: '#2f6df6',
  secondary: '#5ac8fa',
  tertiary: '#ffd166',
};

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `undefined` = kein Schema gesetzt, `null` = ungültig. Farben werden zu `#rrggbb` normalisiert. */
export function parseTheme(input: unknown): Theme | undefined | null {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const theme = { ...DEFAULT_THEME };
  for (const key of THEME_KEYS) {
    const value = record[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !HEX_PATTERN.test(value.trim())) return null;
    theme[key] = normalizeHex(value.trim());
  }
  const logo = record.logo;
  if (logo !== undefined && logo !== null && logo !== '') {
    if (typeof logo !== 'string' || !LOGO_ID_PATTERN.test(logo)) return null;
    theme.logo = logo;
  }
  return theme;
}

export function isDefaultTheme(theme: Theme): boolean {
  return sameColors(theme, DEFAULT_THEME) && !theme.logo;
}

export function sameColors(a: Theme, b: Theme): boolean {
  return THEME_KEYS.every((key) => a[key] === b[key]);
}

/** Lesbare Textfarbe (schwarz/weiß) auf der gegebenen Hintergrundfarbe. */
export function contrastText(hex: string): '#ffffff' | '#10131a' {
  return luminance(hex) > 0.4 ? '#10131a' : '#ffffff';
}

/** So dunkel, dass die Farbe als Präsentations-Hintergrund taugt (z.B. EnBW-Blau). */
export function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.05;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(normalizeHex(hex).slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function normalizeHex(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 4) return `#${[...lower.slice(1)].map((c) => c + c).join('')}`;
  return lower;
}
