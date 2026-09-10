import { VALUE_MAX, VALUE_MIN, type SessionStats } from './protocol.js';

export const HISTOGRAM_SIZE = VALUE_MAX - VALUE_MIN + 1;

export function emptyHistogram(): number[] {
  return new Array<number>(HISTOGRAM_SIZE).fill(0);
}

export function emptyStats(): SessionStats {
  return { count: 0, average: null, median: null, min: null, max: null, histogram: emptyHistogram() };
}

export function computeStats(values: readonly number[]): SessionStats {
  if (values.length === 0) return emptyStats();

  const histogram = emptyHistogram();
  let sum = 0;
  for (const value of values) {
    histogram[value - VALUE_MIN] = (histogram[value - VALUE_MIN] ?? 0) + 1;
    sum += value;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = computeMedian(sorted);

  return {
    count: values.length,
    average: sum / values.length,
    median,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    histogram,
  };
}

/** Erwartet eine aufsteigend sortierte Liste. */
export function computeMedian(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] ?? null;
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

/** Ab dieser Anzahl Antworten wird eine geglättete Dichtekurve gezeichnet. */
export const DENSITY_MIN_SAMPLES = 5;

export interface DensityPoint {
  x: number;
  y: number;
}

/**
 * Kerndichteschätzung (Gauß-Kernel) über dem Histogramm.
 * Gibt normalisierte y-Werte (0..1) zurück; leer, wenn zu wenige Daten vorliegen.
 */
export function computeDensity(
  histogram: readonly number[],
  count: number,
  resolution = 201,
): DensityPoint[] {
  if (count < DENSITY_MIN_SAMPLES) return [];

  const values: number[] = [];
  for (let i = 0; i < histogram.length; i += 1) {
    const bucket = histogram[i] ?? 0;
    for (let k = 0; k < bucket; k += 1) values.push(VALUE_MIN + i);
  }
  if (values.length === 0) return [];

  const bandwidth = silvermanBandwidth(values);
  const points: DensityPoint[] = [];
  let maxY = 0;

  for (let i = 0; i < resolution; i += 1) {
    const x = VALUE_MIN + ((VALUE_MAX - VALUE_MIN) * i) / (resolution - 1);
    let y = 0;
    for (const value of values) {
      const u = (x - value) / bandwidth;
      y += Math.exp(-0.5 * u * u);
    }
    y /= values.length * bandwidth * Math.sqrt(2 * Math.PI);
    if (y > maxY) maxY = y;
    points.push({ x, y });
  }

  if (maxY <= 0) return [];
  return points.map((p) => ({ x: p.x, y: p.y / maxY }));
}

/** Silverman's rule of thumb, nach unten begrenzt, damit die Kurve nicht zu Spikes zerfällt. */
export function silvermanBandwidth(values: readonly number[]): number {
  const n = values.length;
  const mean = values.reduce((acc, v) => acc + v, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const sorted = [...values].sort((a, b) => a - b);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const spread = iqr > 0 ? Math.min(stdDev, iqr / 1.349) : stdDev;

  const bandwidth = 0.9 * (spread || stdDev) * Math.pow(n, -1 / 5);
  return Math.max(bandwidth, 2.5);
}

/** Lineare Interpolation; erwartet eine aufsteigend sortierte Liste. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(pos);
  const upperIndex = Math.ceil(pos);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (pos - lowerIndex);
}
