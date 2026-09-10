import { describe, expect, it } from 'vitest';
import { computeDensity, computeMedian, computeStats, emptyStats } from './stats.js';

describe('computeStats – Durchschnitt', () => {
  it('liefert null bei leerer Eingabe', () => {
    const stats = emptyStats();
    expect(stats.count).toBe(0);
    expect(stats.average).toBeNull();
    expect(stats.median).toBeNull();
    expect(stats.histogram).toHaveLength(101);
    expect(stats.histogram.every((v) => v === 0)).toBe(true);
  });

  it('berechnet den Durchschnitt korrekt', () => {
    expect(computeStats([10, 20, 30]).average).toBe(20);
    expect(computeStats([0, 100]).average).toBe(50);
    expect(computeStats([1, 2]).average).toBe(1.5);
    expect(computeStats([42]).average).toBe(42);
  });
});

describe('computeStats – Median', () => {
  it('berechnet den Median bei ungerader Anzahl', () => {
    expect(computeStats([5, 1, 3]).median).toBe(3);
    expect(computeStats([100, 0, 50, 20, 80]).median).toBe(50);
  });

  it('berechnet den Median bei gerader Anzahl als Mittel der beiden mittleren Werte', () => {
    expect(computeStats([10, 20, 30, 40]).median).toBe(25);
    expect(computeStats([0, 100]).median).toBe(50);
  });

  it('computeMedian erwartet sortierte Eingaben', () => {
    expect(computeMedian([])).toBeNull();
    expect(computeMedian([7])).toBe(7);
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('computeStats – Verteilung', () => {
  it('zählt jeden Wert im passenden Histogramm-Bucket', () => {
    const stats = computeStats([0, 0, 50, 100]);
    expect(stats.histogram[0]).toBe(2);
    expect(stats.histogram[50]).toBe(1);
    expect(stats.histogram[100]).toBe(1);
    expect(stats.histogram.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('liefert min und max', () => {
    const stats = computeStats([30, 70, 10]);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(70);
    expect(stats.count).toBe(3);
  });
});

describe('computeDensity', () => {
  it('liefert keine Kurve ohne Antworten', () => {
    const stats = emptyStats();
    expect(computeDensity(stats.histogram, stats.count)).toEqual([]);
  });

  it('erzeugt schon bei einer Antwort eine Glocke mit Peak auf dem gewählten Wert', () => {
    for (const value of [0, 25, 67, 100]) {
      const stats = computeStats([value]);
      const density = computeDensity(stats.histogram, stats.count);
      expect(density.length).toBeGreaterThan(0);
      const peak = density.reduce((best, p) => (p.y > best.y ? p : best), density[0]!);
      expect(Math.abs(peak.x - value)).toBeLessThanOrEqual(0.5);
      expect(peak.y).toBeCloseTo(1, 6);
    }
  });

  it('liefert eine normalisierte Kurve ab 5 Antworten', () => {
    const stats = computeStats([40, 45, 50, 55, 60]);
    const density = computeDensity(stats.histogram, stats.count);
    expect(density.length).toBeGreaterThan(0);
    expect(Math.max(...density.map((p) => p.y))).toBeCloseTo(1, 6);
    expect(density.every((p) => p.y >= 0 && p.y <= 1)).toBe(true);
    expect(density[0]?.x).toBe(0);
    expect(density[density.length - 1]?.x).toBe(100);
  });

  it('setzt das Maximum der Kurve nahe dem Schwerpunkt der Daten', () => {
    const stats = computeStats([70, 72, 74, 76, 78, 80]);
    const density = computeDensity(stats.histogram, stats.count);
    const peak = density.reduce((best, p) => (p.y > best.y ? p : best), density[0]!);
    expect(peak.x).toBeGreaterThan(65);
    expect(peak.x).toBeLessThan(85);
  });

  it('bildet zwei Gruppen als zwei Maxima ab', () => {
    const stats = computeStats([5, 6, 7, 8, 92, 93, 94, 95]);
    const density = computeDensity(stats.histogram, stats.count);
    const left = density.filter((p) => p.x < 50);
    const right = density.filter((p) => p.x >= 50);
    expect(Math.max(...left.map((p) => p.y))).toBeGreaterThan(0.5);
    expect(Math.max(...right.map((p) => p.y))).toBeGreaterThan(0.5);
    const middle = density.find((p) => Math.abs(p.x - 50) < 1);
    expect(middle!.y).toBeLessThan(0.2);
  });
});
