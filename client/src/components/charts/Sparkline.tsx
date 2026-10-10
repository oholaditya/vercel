import type { TelemetryPoint } from '@shared/types';

/** Tiny inline trend glyph (decorative; the value is always printed beside it). */
export function Sparkline({ points, width = 96, height = 28, threshold }: { points: TelemetryPoint[]; width?: number; height?: number; threshold?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden />;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals, threshold ?? Infinity);
  const hi = Math.max(...vals, threshold !== undefined && threshold < Math.max(...vals) * 2 ? threshold : -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - lo) / span) * (height - 6);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const last = points[points.length - 1]!;
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      {threshold !== undefined && threshold <= hi && (
        <line x1={0} x2={width} y1={y(threshold)} y2={y(threshold)} stroke="var(--crit)" strokeDasharray="2 3" strokeWidth={1} opacity={0.7} />
      )}
      <path d={d} fill="none" stroke="var(--chart)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.5} fill="var(--chart)" />
    </svg>
  );
}
