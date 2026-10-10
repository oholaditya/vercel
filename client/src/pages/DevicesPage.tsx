import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { DeviceSnapshot, HubEvent } from '@shared/types';
import { api } from '../lib/api';
import { ago, dateTime } from '../lib/format';
import { useDeviceList, useHub } from '../state/hub';
import { kindGroup, kindLabel, METRIC_META, type DeviceGroup } from '../theme/tokens';
import { LineChart } from '../components/charts/LineChart';
import { thresholdsFor } from '../components/charts/TelemetryPanel';
import { DeviceGrid } from '../components/devices/DeviceGrid';
import { DeviceIcon } from '../components/devices/DeviceIcon';
import { EventRow } from '../components/events/EventFeed';
import { Badge, EmptyState, inputClass, PageHeader, Segmented, SimBadge } from '../components/ui/primitives';

type Filter = 'all' | DeviceGroup;
const GROUPS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'climate', label: 'Climate' },
  { value: 'safety', label: 'Safety' },
  { value: 'security', label: 'Security' },
];

export function DevicesPage() {
  const devices = useDeviceList();
  const [group, setGroup] = useState<Filter>('all');
  const [room, setRoom] = useState('all');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const rooms = useMemo(() => [...new Set(devices.map((d) => d.room))].sort(), [devices]);
  const shown = devices.filter(
    (d) =>
      (group === 'all' || kindGroup[d.kind] === group) &&
      (room === 'all' || d.room === room) &&
      (!q || `${d.name} ${d.id} ${d.room}`.toLowerCase().includes(q.toLowerCase())),
  );
  const online = devices.filter((d) => d.online).length;

  return (
    <>
      <PageHeader
        title="Devices"
        description="Control actuators and inspect sensors through the device abstraction layer. Every command is validated by the hub before it reaches an adapter."
        actions={
          <Badge tone={online === devices.length ? 'ok' : 'warn'}>
            {online}/{devices.length} online
          </Badge>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 lg:flex-row lg:items-center">
        <div className="w-full lg:max-w-md">
          <Segmented<Filter> label="Device category" value={group} options={GROUPS} onChange={setGroup} />
        </div>
        <div className="flex flex-1 gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
            <input className={`${inputClass} pl-9`} placeholder="Search devices…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
          </div>
          <div className="relative">
            <SlidersHorizontal className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
            <select className={`${inputClass} pl-9`} value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Filter by room">
              <option value="all">All rooms</option>
              {rooms.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Search className="size-6" />} title="No devices match these filters" />
      ) : (
        <DeviceGrid devices={shown} onDetails={setDetail} />
      )}

      {detail && <DeviceDrawer id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function DeviceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const hub = useHub();
  const d = hub.devices[id] as DeviceSnapshot | undefined;
  const [events, setEvents] = useState<HubEvent[]>([]);

  useEffect(() => {
    api.events({ deviceId: id, limit: 25 }).then((r) => setEvents(r.events)).catch(() => undefined);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [id, onClose]);

  if (!d) return null;
  const metric = d.kind === 'thermostat' ? 'temperature' : d.kind === 'smoke' ? 'obscuration' : d.kind === 'co' ? 'co_ppm' : null;
  const meta = metric ? METRIC_META[metric] : null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${d.name} details`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-line bg-bg-elev shadow-card">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent">
            <DeviceIcon kind={d.kind} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold text-fg">{d.name}</h2>
              {d.origin === 'simulated' && <SimBadge />}
            </div>
            <div className="text-xs text-fg-3">
              {d.room} · {kindLabel[d.kind]}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-fg-2 hover:bg-surface-2 hover:text-fg" aria-label="Close details" autoFocus>
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-sm">
            {[
              ['Device ID', <span className="num">{d.id}</span>],
              ['Adapter', <span className="num">{d.adapterId}</span>],
              ['Data origin', d.origin === 'simulated' ? 'Simulated (software)' : 'External bridge'],
              ['Connectivity', d.online ? 'Online' : 'Offline'],
              ['Health', d.health],
              ['Last heartbeat', d.lastSeen ? ago(d.lastSeen) : 'never'],
              ['Battery', d.battery !== null ? `${d.battery}%` : 'Mains powered'],
              ['State', <span className="num text-xs break-all">{JSON.stringify(d.state)}</span>],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-surface px-3 py-2.5">
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-1 text-fg-2">{v}</dd>
              </div>
            ))}
          </dl>

          {metric && meta && (
            <section>
              <h3 className="eyebrow mb-2">
                {meta.label} ({meta.unit})
              </h3>
              <div className="rounded-lg border border-line bg-surface p-2">
                <LineChart points={hub.telemetry[d.id] ?? []} unit={meta.unit} digits={meta.digits} thresholds={thresholdsFor(metric)} label={`${d.name} ${meta.label}`} floor={metric === 'temperature' ? undefined : 0} height={200} />
              </div>
            </section>
          )}

          <section>
            <h3 className="eyebrow mb-2">Recent events</h3>
            {events.length === 0 ? (
              <p className="text-sm text-fg-3">No recorded events for this device.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                {events.map((e) => (
                  <EventRow key={e.id} e={e} compact />
                ))}
              </ul>
            )}
            <p className="mt-2 text-2xs text-fg-3">Times shown in local time · first event {events.length ? dateTime(events[events.length - 1]!.ts) : '-'}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
