import { useMemo, useState } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import type { EventPriority, HubEvent } from '@shared/types';
import { timeOfDay } from '../../lib/format';
import { priorityTone, toneBg, toneText } from '../../theme/tokens';
import { cx, EmptyState, SimBadge } from '../ui/primitives';

const FILTERS: Array<{ value: EventPriority | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
];

export function PriorityTag({ priority }: { priority: EventPriority }) {
  const tone = priorityTone[priority];
  return <span className={cx('num w-14 shrink-0 text-[10px] font-semibold tracking-wider uppercase', toneText[tone])}>{priority}</span>;
}

export function EventRow({ e, compact }: { e: HubEvent; compact?: boolean }) {
  const tone = priorityTone[e.priority];
  return (
    <li className="group relative flex gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
      <span aria-hidden className={cx('absolute top-3 bottom-3 left-0 w-0.5 rounded-r', toneBg[tone], e.priority === 'low' && 'opacity-40')} />
      <time className="num w-[4.25rem] shrink-0 pt-px text-xs text-fg-3" dateTime={e.ts}>
        {timeOfDay(e.ts)}
      </time>
      <div className="min-w-0 flex-1">
        <div className={cx('text-sm leading-snug', e.priority === 'critical' ? 'font-medium text-fg' : 'text-fg-2')}>{e.message}</div>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-fg-3">
            <PriorityTag priority={e.priority} />
            <span className="num">{e.type}</span>
            {e.deviceId && <span className="num">· {e.deviceId}</span>}
          </div>
        )}
      </div>
      {e.simulated && <SimBadge className="mt-0.5 h-fit shrink-0" />}
    </li>
  );
}

/** Live event monitor: newest first, priority filter, pause to inspect. */
export function EventFeed({ events, maxHeight = 520 }: { events: HubEvent[]; maxHeight?: number }) {
  const [filter, setFilter] = useState<EventPriority | 'all'>('all');
  const [frozen, setFrozen] = useState<HubEvent[] | null>(null);
  const source = frozen ?? events;
  const shown = useMemo(() => source.filter((e) => filter === 'all' || e.priority === filter).slice(0, 120), [source, filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex gap-1" role="tablist" aria-label="Filter events by priority">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cx(
                'rounded-md px-2 py-1 text-2xs font-semibold tracking-wide uppercase transition-colors',
                filter === f.value ? 'bg-surface-3 text-fg' : 'text-fg-3 hover:text-fg-2',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setFrozen(frozen ? null : events)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-semibold tracking-wide text-fg-3 uppercase transition-colors hover:text-fg"
          aria-pressed={!!frozen}
        >
          {frozen ? <Play className="size-3" /> : <Pause className="size-3" />}
          {frozen ? 'Resume' : 'Pause'}
        </button>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Radio className="size-6" />} title="No events yet" hint="Events appear here in real time as devices report." />
      ) : (
        <ul className="divide-y divide-line overflow-y-auto" style={{ maxHeight }} aria-live={frozen ? 'off' : 'polite'} aria-relevant="additions">
          {shown.map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
