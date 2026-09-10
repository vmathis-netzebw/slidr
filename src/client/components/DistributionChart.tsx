import { useMemo } from 'react';
import { VALUE_MAX, VALUE_MIN, type SessionStats } from '../../shared/protocol.js';
import { ROBUST_MIN_SAMPLES, computeDensity } from '../../shared/stats.js';

interface DistributionChartProps {
  stats: SessionStats;
  leftLabel: string;
  rightLabel: string;
}

const WIDTH = 1000;
const HEIGHT = 420;
const PADDING_X = 40;
const PADDING_TOP = 30;
const PADDING_BOTTOM = 50;
/** Anzahl der Balken im Histogramm (Buckets à 5 Punkte). */
const BINS = 20;

const AXIS_TICKS = [0, 25, 50, 75, 100];

export function DistributionChart({
  stats,
  leftLabel,
  rightLabel,
}: DistributionChartProps): JSX.Element {
  const bins = useMemo(() => binHistogram(stats.histogram, BINS), [stats.histogram]);
  const density = useMemo(
    () => computeDensity(stats.histogram, stats.count),
    [stats.histogram, stats.count],
  );

  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const baselineY = HEIGHT - PADDING_BOTTOM;
  const maxBin = Math.max(1, ...bins);

  const xForValue = (value: number): number =>
    PADDING_X + ((value - VALUE_MIN) / (VALUE_MAX - VALUE_MIN)) * plotWidth;

  const curvePath = useMemo(() => {
    if (density.length === 0) return '';
    return density
      .map((point, index) => {
        const x = xForValue(point.x);
        const y = baselineY - point.y * plotHeight * 0.92;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  const areaPath = curvePath
    ? `${curvePath} L${xForValue(VALUE_MAX).toFixed(2)} ${baselineY} L${xForValue(VALUE_MIN).toFixed(2)} ${baselineY} Z`
    : '';

  const rawValues = useMemo(() => expandValues(stats.histogram), [stats.histogram]);
  // Bei wenigen Antworten bleiben die Einzelwerte sichtbar, damit die Kurve nicht mehr suggeriert als da ist.
  const showRawMarkers = stats.count > 0 && stats.count < ROBUST_MIN_SAMPLES;

  if (stats.count === 0) {
    return (
      <div className="chart chart--empty">
        <p>Noch keine Antworten.</p>
        <span>QR-Code scannen und abstimmen.</span>
        <div className="chart__poles">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      </div>
    );
  }

  const binWidth = plotWidth / BINS;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart__svg" role="img" aria-label="Verteilung der Antworten">
        <defs>
          <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5ac8fa" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#5ac8fa" stopOpacity="0" />
          </linearGradient>
        </defs>

        {showRawMarkers
          ? null
          : bins.map((count, index) => {
              const height = (count / maxBin) * plotHeight;
              const x = PADDING_X + index * binWidth;
              return (
                <rect
                  key={index}
                  x={x + 2}
                  y={baselineY - height}
                  width={Math.max(1, binWidth - 4)}
                  height={height}
                  rx={4}
                  className="chart__bar"
                />
              );
            })}

        {areaPath ? <path d={areaPath} fill="url(#curveFill)" /> : null}
        {curvePath ? <path d={curvePath} className="chart__curve" /> : null}

        {showRawMarkers
          ? rawValues.map((value, index) => (
              <g key={`${value}-${index}`}>
                <line
                  x1={xForValue(value)}
                  x2={xForValue(value)}
                  y1={baselineY}
                  y2={baselineY - 26}
                  className="chart__marker"
                />
                <circle cx={xForValue(value)} cy={baselineY - 26} r={7} className="chart__dot" />
              </g>
            ))
          : null}

        {stats.average !== null ? (
          <line
            x1={xForValue(stats.average)}
            x2={xForValue(stats.average)}
            y1={PADDING_TOP}
            y2={baselineY}
            className="chart__average"
          />
        ) : null}

        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={baselineY} y2={baselineY} className="chart__axis" />

        {AXIS_TICKS.map((tick) => (
          <g key={tick}>
            <line
              x1={xForValue(tick)}
              x2={xForValue(tick)}
              y1={baselineY}
              y2={baselineY + 10}
              className="chart__axis"
            />
            <text x={xForValue(tick)} y={baselineY + 38} textAnchor="middle" className="chart__tick">
              {tick}
            </text>
          </g>
        ))}
      </svg>

      <div className="chart__poles">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>

      {stats.count < ROBUST_MIN_SAMPLES ? (
        <p className="chart__hint">
          {stats.count === 1 ? '1 Antwort' : `${stats.count} Antworten`} – zu wenige Daten für eine
          belastbare Verteilung.
        </p>
      ) : null}
    </div>
  );
}

/** Fasst das 101-Werte-Histogramm zu `bins` Balken zusammen. */
export function binHistogram(histogram: readonly number[], bins: number): number[] {
  const result = new Array<number>(bins).fill(0);
  const span = VALUE_MAX - VALUE_MIN + 1;
  for (let value = 0; value < histogram.length; value += 1) {
    const count = histogram[value] ?? 0;
    if (count === 0) continue;
    const index = Math.min(bins - 1, Math.floor((value / span) * bins));
    result[index] = (result[index] ?? 0) + count;
  }
  return result;
}

function expandValues(histogram: readonly number[]): number[] {
  const values: number[] = [];
  for (let i = 0; i < histogram.length; i += 1) {
    const count = histogram[i] ?? 0;
    for (let k = 0; k < count; k += 1) values.push(VALUE_MIN + i);
  }
  return values;
}
