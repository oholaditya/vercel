import { useState } from 'react';
import { DoorOpen, Flame, FlaskConical, Radar, RotateCcw, Unplug, Wind, Plug } from 'lucide-react';
import type { SimulationScenario } from '@shared/types';
import { api } from '../lib/api';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Card, CardHeader, cx } from './ui/primitives';

const ALL: Array<{ s: SimulationScenario; label: string; hint: string; icon: typeof Flame; tone?: 'crit' | 'warn' }> = [
  { s: 'smoke', label: 'Smoke build-up', hint: 'A smoke sensor ramps past 10 %/m', icon: Flame, tone: 'crit' },
  { s: 'co', label: 'CO leak', hint: 'A CO sensor rises past 35 → 70 ppm', icon: Wind, tone: 'crit' },
  { s: 'intrusion', label: 'Door opened', hint: 'A door/window contact opens', icon: DoorOpen, tone: 'warn' },
  { s: 'motion', label: 'Motion', hint: 'A motion sensor trips', icon: Radar },
  { s: 'disconnect', label: 'Link loss', hint: 'A CO sensor stops heartbeating', icon: Unplug, tone: 'warn' },
  { s: 'reconnect', label: 'Reconnect all', hint: 'Restore simulated links', icon: Plug },
  { s: 'clear', label: 'Clear conditions', hint: 'Return sensors to baseline', icon: RotateCcw },
];

/** Inject named, clearly-labelled simulated scenarios (operator+). */
export function SimulationControls({ only, title = 'Scenario injection' }: { only?: SimulationScenario[]; title?: string }) {
  const { can } = useAuth();
  const notify = useToast();
  const [busy, setBusy] = useState<SimulationScenario | null>(null);
  const items = only ? ALL.filter((i) => only.includes(i.s)) : ALL;

  const run = async (s: SimulationScenario) => {
    setBusy(s);
    try {
      const r = await api.scenario(s);
      notify('success', `[SIMULATION] ${r.description}`);
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-dashed border-warn/30">
      <CardHeader icon={<FlaskConical className="size-4 text-warn" />} eyebrow="Simulator" title={title} />
      <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
        {items.map(({ s, label, hint, icon: Icon, tone }) => (
          <button
            key={s}
            disabled={!can('operator') || busy !== null}
            onClick={() => void run(s)}
            className={cx(
              'group flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50',
              busy === s && 'border-warn/50',
            )}
          >
            <Icon className={cx('mt-0.5 size-4 shrink-0', tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-fg-3')} />
            <span>
              <span className="block text-sm font-medium text-fg">{label}</span>
              <span className="block text-2xs text-fg-3">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2 text-2xs text-fg-3">
        {can('operator') ? 'Injected events are tagged SIMULATED end-to-end (events, alerts, audit log).' : 'Operator role required to inject scenarios.'}
      </p>
    </Card>
  );
}
