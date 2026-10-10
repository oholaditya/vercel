import type { ReactNode } from 'react';
import { toneText, type Tone } from '../../theme/tokens';
import { cx } from './primitives';

/** KPI tile: one headline number, a label, and a short qualifier. */
export function StatTile({ label, value, sub, icon, tone = 'neutral', children }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: Tone; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        <span className={cx('rounded-md border border-line bg-surface-2 p-1.5', tone === 'neutral' ? 'text-fg-3' : toneText[tone])}>{icon}</span>
      </div>
      <div className={cx('num mt-2 text-2xl font-semibold tracking-tight', tone === 'neutral' ? 'text-fg' : toneText[tone])}>{value}</div>
      {sub && <div className="mt-1 text-xs text-fg-3">{sub}</div>}
      {children}
    </div>
  );
}
