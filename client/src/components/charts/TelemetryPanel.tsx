import { useMemo, useState } from 'react';
import { LineChart as LineIcon } from 'lucide-react';
import type { DeviceSnapshot } from '@shared/types';
import { useHub } from '../../state/hub';
import { METRIC_META } from '../../theme/tokens';
import { Card, CardHeader, cx, SimBadge } from '../ui/primitives';
import { LineChart, type Threshold } from './LineChart';

const metricFor = (d: DeviceSnapshot) => (d.kind === 'thermostat' ? 'temperature' : d.kind === 'smoke' ? 'obscuration' : 'co_ppm');

export function thresholdsFor(metric: keyof typeof METRIC_META): Threshold[] {
  const m = METRIC_META[metric];
  const out: Threshold[] = [];
  if (m.warn !== undefined) out.push({ value: m.warn, tone: 'warn', label: 'warn' });
  if (m.crit !== undefined) out.push({ value: m.crit, tone: 'crit', label: 'alarm' });
  return out;
}

/** Sensor readings over time; one sensor at a time (single series, single axis). */
export function TelemetryPanel() {
  const { devices, telemetry } = useHub();
  const sensors = useMemo(
    () => Object.values(devices).filter((d) => d.kind === 'thermostat' || d.kind === 'smoke' || d.kind === 'co').sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    [devices],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const device = sensors.find((s) => s.id === selected) ?? sensors.find((s) => s.kind === 'co') ?? sensors[0];
  if (!device) return null;
  const metric = metricFor(device);
  const meta = METRIC_META[metric];
  const points = telemetry[device.id] ?? [];
  const last = points[points.length - 1];

  return (
    <Card>
      <CardHeader
        icon={<LineIcon className="size-4" />}
        eyebrow="Sensor telemetry"
        title={
          <span className="flex items-center gap-2">
            {device.name} {device.origin === 'simulated' && <SimBadge />}
          </span>
        }
        actions={
          <select
            aria-label="Select sensor"
            value={device.id}
            onChange={(e) => setSelected(e.target.value)}
            className="h-8 max-w-[11rem] rounded-lg border border-line bg-surface-2 px-2 text-xs text-fg focus:border-accent focus:outline-none sm:max-w-none"
          >
            {sensors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        }
      />
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 pt-3">
        <div>
          <span className="num text-2xl font-semibold text-fg">{last ? last.value.toFixed(meta.digits) : '-'}</span>
          <span className="ml-1 text-sm text-fg-3">{meta.unit}</span>
        </div>
        <span className="text-xs text-fg-3">{meta.label} · last {points.length} samples</span>
        <span className={cx('ml-auto flex items-center gap-1.5 text-2xs text-fg-3')}>
          <span className="inline-block h-0.5 w-4 rounded bg-chart" /> reading
          <span className="ml-2 inline-block w-4 border-t border-dashed border-crit" /> threshold
        </span>
      </div>
      <div className="px-2 pt-2 pb-3">
        <LineChart points={points} unit={meta.unit} digits={meta.digits} thresholds={thresholdsFor(metric)} label={`${device.name} ${meta.label}`} floor={metric === 'temperature' ? undefined : 0} height={220} />
      </div>
    </Card>
  );
}
