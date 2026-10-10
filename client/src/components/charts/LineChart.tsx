import { useMemo, useState } from 'react';
import type { TelemetryPoint } from '@shared/types';
import { timeOfDay } from '../../lib/format';
import type { Tone } from '../../theme/tokens';
import { niceRange, useWidth } from './useWidth';

export interface Threshold {
  value: number;
  tone: Extract<Tone, 'warn' | 'crit'>;
  label: string;
}

const toneVar = { warn: 'var(--warn)', crit: 'var(--crit)' } as const;
const M = { top: 12, right: 12, bottom: 22, left: 40 };

/**
 * Single-series time chart: 2px line, recessive grid, dashed threshold
 * reference lines, crosshair + tooltip on hover. Accessible via an
 * aria-label summary and a visually-hidden data table.
 */
export function LineChart({
  points,
  unit,
  digits = 1,
  height = 200,
  thresholds = [],
  label,
  floor,
}: {
  points: TelemetryPoint[];
  unit: string;
  digits?: number;
  height?: number;
  thresholds?: Threshold[];
  label: string;
  floor?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const values = points.map((p) => p.value);
    const visibleThresholds = thresholds.filter((t) => {
      const max = Math.max(...values, -Infinity);
      return values.length === 0 || t.value <= max * 1.6 + 1;
    });
    const lo = Math.min(...values, ...visibleThresholds.map((t) => t.value), floor ?? Infinity);
    const hi = Math.max(...values, ...visibleThresholds.map((t) => t.value));
    const r = niceRange(lo, hi);
    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    const x = (i: number) => M.left + (points.length <= 1 ? iw : (i / (points.length - 1)) * iw);
    const y = (v: number) => M.top + ih - ((v - r.lo) / (r.hi - r.lo || 1)) * ih;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)},${M.top + ih}L${x(0).toFixed(1)},${M.top + ih}Z` : '';
    const ticks: number[] = [];
    for (let v = r.lo; v <= r.hi + r.step / 2; v += r.step) ticks.push(v);
    const xTicks = points.length > 3 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [];
    return { x, y, line, area, ticks, xTicks, iw, ih, visibleThresholds };
  }, [points, thresholds, width, height, floor]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  };

  const hp = hover !== null ? points[hover] : undefined;
  const last = points[points.length - 1];
  const summary = last ? `${label}: latest ${last.value.toFixed(digits)} ${unit}, ${points.length} samples` : `${label}: no data`;

  return (
    <div ref={ref} className="relative w-full select-none">
      {points.length === 0 ? (
        <div style={{ height }} className="flex items-center justify-center text-xs text-fg-3">
          Waiting for telemetry…
        </div>
      ) : (
        <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible">
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 font-mono text-[10px]">
                {Number(t.toFixed(2))}
              </text>
            </g>
          ))}
          {geo.xTicks.map((i, k) => (
            <text
              key={i}
              x={geo.x(i)}
              y={height - 6}
              textAnchor={k === 0 ? 'start' : k === geo.xTicks.length - 1 ? 'end' : 'middle'}
              className="fill-fg-3 font-mono text-[10px]"
            >
              {timeOfDay(points[i]!.ts).slice(0, 5)}
            </text>
          ))}
          {geo.visibleThresholds.map((t) => (
            <g key={t.label}>
              <line
                x1={M.left}
                x2={width - M.right}
                y1={geo.y(t.value)}
                y2={geo.y(t.value)}
                stroke={toneVar[t.tone]}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.8}
              />
              <text x={width - M.right} y={geo.y(t.value) - 4} textAnchor="end" className="font-mono text-[10px]" fill={toneVar[t.tone]}>
                {t.label} {t.value}
              </text>
            </g>
          ))}
          <path d={geo.area} fill="var(--chart)" opacity={0.035} />
          <path d={geo.line} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last && !hp && (
            <circle cx={geo.x(points.length - 1)} cy={geo.y(last.value)} r={4} fill="var(--chart)" stroke="var(--surface)" strokeWidth={2} />
          )}
          {hp && hover !== null && (
            <g pointerEvents="none">
              <line x1={geo.x(hover)} x2={geo.x(hover)} y1={M.top} y2={M.top + geo.ih} stroke="var(--line-strong)" strokeWidth={1} />
              <circle cx={geo.x(hover)} cy={geo.y(hp.value)} r={4.5} fill="var(--chart)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={Math.max(0, geo.iw)}
            height={Math.max(0, geo.ih)}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 shadow-card"
          style={{
            left: Math.min(Math.max(geo.x(hover) - 60, 0), width - 120),
            top: Math.max(geo.y(hp.value) - 52, 0),
            width: 120,
          }}
        >
          <div className="num text-sm font-semibold text-fg">
            {hp.value.toFixed(digits)} <span className="text-xs font-normal text-fg-3">{unit}</span>
          </div>
          <div className="num text-2xs text-fg-3">{timeOfDay(hp.ts)}</div>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.slice(-20).map((p) => (
            <tr key={p.ts}>
              <td>{p.ts}</td>
              <td>
                {p.value} {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
