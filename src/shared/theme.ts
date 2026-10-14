/** CI-Farbschema für Umfragen und Feedback-Bögen. */
export interface Theme {
  /** Buttons, Auswahl, Slider, Balken. */
  primary: string;
  /** Verteilungskurve und Kennzahlen auf der Präsentationsansicht. */
  secondary: string;
  /** Hervorhebungen wie die Durchschnittslinie. */
  tertiary: string;
}

export const THEME_KEYS = ['primary', 'secondary', 'tertiary'] as const;

export const THEME_LABELS: Record<keyof Theme, string> = {
  primary: 'Primärfarbe',
  secondary: 'Sekundärfarbe',
  tertiary: 'Tertiärfarbe',
};

export const DEFAULT_THEME: Theme = {
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
  return theme;
}

export function isDefaultTheme(theme: Theme): boolean {
  return THEME_KEYS.every((key) => theme[key] === DEFAULT_THEME[key]);
}

/** Lesbare Textfarbe (schwarz/weiß) auf der gegebenen Hintergrundfarbe. */
export function contrastText(hex: string): '#ffffff' | '#10131a' {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(normalizeHex(hex).slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#10131a' : '#ffffff';
}

function normalizeHex(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 4) return `#${[...lower.slice(1)].map((c) => c + c).join('')}`;
  return lower;
}
