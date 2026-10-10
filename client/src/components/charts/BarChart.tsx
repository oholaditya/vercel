import { useMemo, useState } from 'react';
import type { ActivityBucket } from '@shared/types';
import { timeOfDay } from '../../lib/format';
import { niceRange, useWidth } from './useWidth';

const M = { top: 10, right: 8, bottom: 22, left: 32 };

/** Single-series bar chart for event throughput per minute, with per-bar hover. */
export function BarChart({ buckets, height = 180, label }: { buckets: ActivityBucket[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const r = niceRange(0, max, 3);
    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    const slot = iw / Math.max(1, buckets.length);
    const bw = Math.max(2, slot - 2); // 2px surface gap between bars
    const y = (v: number) => M.top + ih - (v / (r.hi || 1)) * ih;
    const ticks: number[] = [];
    for (let v = 0; v <= r.hi + r.step / 2; v += r.step) ticks.push(v);
    return { slot, bw, y, ih, ticks };
  }, [buckets, width, height]);

  const total = buckets.reduce((n, b) => n + b.count, 0);
  const hb = hover !== null ? buckets[hover] : undefined;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} role="img" aria-label={`${label}: ${total} events in ${buckets.length} minutes`} className="block">
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--grid)" />
            <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 font-mono text-[10px]">
              {Number(t.toFixed(1))}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = M.left + i * geo.slot + 1;
          const h = Math.max(b.count > 0 ? 2 : 0, M.top + geo.ih - geo.y(b.count));
          const yTop = M.top + geo.ih - h;
          const r = Math.min(3, geo.bw / 2, h);
          // Rounded data-end (top), square baseline.
          const d = h > 0 ? `M${x},${M.top + geo.ih}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + geo.bw - r}Q${x + geo.bw},${yTop} ${x + geo.bw},${yTop + r}V${M.top + geo.ih}Z` : '';
          return (
            <g key={b.ts}>
              {d && <path d={d} fill="var(--accent)" opacity={hover === null || hover === i ? 0.9 : 0.4} />}
              <rect
                x={M.left + i * geo.slot}
                y={M.top}
                width={geo.slot}
                height={geo.ih}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            </g>
          );
        })}
        {buckets.length > 2 &&
          [0, Math.floor(buckets.length / 2), buckets.length - 1].map((i, k) => (
            <text
              key={i}
              x={M.left + i * geo.slot + geo.slot / 2}
              y={height - 6}
              textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
              className="fill-fg-3 font-mono text-[10px]"
            >
              {timeOfDay(buckets[i]!.ts).slice(0, 5)}
            </text>
          ))}
      </svg>
      {hb && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 shadow-card"
          style={{ left: Math.min(Math.max(M.left + hover * geo.slot - 50, 0), width - 110), top: 0, width: 110 }}
        >
          <div className="num text-sm font-semibold text-fg">
            {hb.count} <span className="text-xs font-normal text-fg-3">events</span>
          </div>
          <div className="num text-2xs text-fg-3">{timeOfDay(hb.ts).slice(0, 5)}</div>
        </div>
      )}
    </div>
  );
}
