import { ShieldCheck, Siren } from 'lucide-react';
import { useNow } from '../../hooks/useNow';
import { useAuth } from '../../state/auth';
import { useAlertList, useHub } from '../../state/hub';
import { Card, CardHeader, cx, EmptyState } from '../ui/primitives';
import { AlertItem } from './AlertItem';

/**
 * Dedicated emergency section: every unresolved CRITICAL alert, with
 * acknowledge/resolve controls. Always rendered so "no emergencies" is an
 * explicit, visible state rather than an absence.
 */
export function EmergencyPanel({ compact }: { compact?: boolean }) {
  const hub = useHub();
  const { can } = useAuth();
  const now = useNow(10_000);
  const critical = useAlertList().filter((a) => a.severity === 'critical' && a.status !== 'resolved');
  const active = critical.some((a) => a.status === 'active');

  return (
    <Card className={cx(critical.length > 0 && 'border-crit/50')} aria-labelledby="emergency-title">
      <CardHeader
        icon={<Siren className={cx('size-4', critical.length ? 'text-crit' : 'text-fg-3')} />}
        eyebrow="Emergency"
        title={<span id="emergency-title">{critical.length ? `${critical.length} critical alert${critical.length > 1 ? 's' : ''}` : 'No emergencies'}</span>}
        actions={
          active ? (
            <span className="flex items-center gap-1.5 text-2xs font-semibold tracking-wider text-crit uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-crit" /> Action required
            </span>
          ) : null
        }
      />
      {critical.length === 0 ? (
        compact ? (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-fg-2">
            <ShieldCheck className="size-4 text-ok" /> No critical conditions reported.
          </div>
        ) : (
          <EmptyState icon={<ShieldCheck className="size-7 text-ok" />} title="No critical conditions" hint="Smoke, CO and intrusion alerts appear here first." />
        )
      ) : (
        <ul className="divide-y divide-line">
          {critical.map((a) => (
            <AlertItem
              key={a.id}
              alert={a}
              now={now}
              deviceName={a.deviceId ? hub.devices[a.deviceId]?.name : undefined}
              canAct={can('operator')}
              onAcknowledge={() => void hub.acknowledge(a.id)}
              onResolve={() => void hub.resolve(a.id)}
            />
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-2xs text-fg-3">
        Prototype only - not a certified smoke/CO alarm or monitored security service. In a real emergency, follow your local procedures and call emergency services.
      </p>
    </Card>
  );
}
