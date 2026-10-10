import { useEffect, useState } from 'react';
import { History, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, type AuditEntry } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAuth } from '../state/auth';
import { useDeviceList, useHub } from '../state/hub';
import { DeviceGrid } from '../components/devices/DeviceGrid';
import { EventRow } from '../components/events/EventFeed';
import { SimulationControls } from '../components/SimulationControls';
import { Badge, Card, CardHeader, cx, EmptyState, PageHeader } from '../components/ui/primitives';

export function SecurityPage() {
  const hub = useHub();
  const { can } = useAuth();
  const devices = useDeviceList();
  const panel = devices.filter((d) => d.kind === 'security_panel');
  const sensors = devices.filter((d) => d.kind === 'contact' || d.kind === 'motion');
  const openings = sensors.filter((d) => d.kind === 'contact' && (d.state as { open: boolean }).open).length;
  const securityEvents = hub.events.filter((e) => e.type.startsWith('security') || e.type === 'device.state' || (e.type === 'alert.raised' && e.data?.category === 'intrusion')).slice(0, 40);
  const armed = panel[0] && (panel[0].state as { mode: string }).mode !== 'disarmed';

  return (
    <>
      <PageHeader
        title="Security"
        description="Arm the system, monitor perimeter sensors, and review security events and the access audit trail."
        actions={
          <>
            <Badge tone={armed ? 'ok' : 'neutral'} icon={armed ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}>
              {armed ? 'Armed' : 'Disarmed'}
            </Badge>
            <Badge tone={openings ? 'warn' : 'ok'}>{openings ? `${openings} opening(s) open` : 'Perimeter secure'}</Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <DeviceGrid devices={[...panel, ...sensors]} className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3" />
          <SimulationControls only={['intrusion', 'motion', 'clear']} title="Test the security chain" />
        </div>
        <Card className="flex flex-col overflow-hidden">
          <CardHeader icon={<History className="size-4" />} eyebrow="Security log" title="Recent security events" />
          {securityEvents.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="size-6" />} title="No security events yet" />
          ) : (
            <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
              {securityEvents.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can('admin') && <AuditLog />}
    </>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.audit(80).then((r) => alive && setEntries(r.entries)).catch(() => undefined);
    load();
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader icon={<ScrollText className="size-4" />} eyebrow="Admin" title="Access & command audit log" actions={<span className="text-2xs text-fg-3">refreshes every 10s</span>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {['Time', 'Actor', 'Action', 'Outcome', 'Detail'].map((h) => (
                <th key={h} className="eyebrow px-4 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.map((e) => (
              <tr key={e.id} className="transition-colors hover:bg-surface-2">
                <td className="num px-4 py-2 text-xs whitespace-nowrap text-fg-3">{dateTime(e.ts)}</td>
                <td className="px-4 py-2 text-fg-2">{e.actor}</td>
                <td className="num px-4 py-2 text-xs text-fg-2">{e.action}</td>
                <td className="px-4 py-2">
                  <span className={cx('text-2xs font-semibold tracking-wide uppercase', e.outcome === 'success' ? 'text-ok' : e.outcome === 'denied' ? 'text-warn' : 'text-crit')}>{e.outcome}</span>
                </td>
                <td className="max-w-[360px] truncate px-4 py-2 text-xs text-fg-3" title={e.detail ?? ''}>
                  {e.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
