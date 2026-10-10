import { AlertTriangle, CheckCheck, CircleCheck, OctagonAlert } from 'lucide-react';
import type { Alert } from '@shared/types';
import { ago, dateTime } from '../../lib/format';
import { severityTone, toneText } from '../../theme/tokens';
import { Badge, Button, cx, SimBadge } from '../ui/primitives';

export function SeverityIcon({ severity, className }: { severity: Alert['severity']; className?: string }) {
  const Icon = severity === 'critical' ? OctagonAlert : AlertTriangle;
  return <Icon className={cx(toneText[severityTone[severity]], className)} aria-label={severity} />;
}

export function AlertItem({
  alert,
  deviceName,
  canAct,
  onAcknowledge,
  onResolve,
  now,
}: {
  alert: Alert;
  deviceName?: string;
  canAct: boolean;
  onAcknowledge: () => void;
  onResolve: () => void;
  now?: number;
}) {
  const tone = severityTone[alert.severity];
  const resolved = alert.status === 'resolved';
  return (
    <li className={cx('flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center', resolved && 'opacity-60')}>
      <div className="flex min-w-0 flex-1 gap-3">
        <SeverityIcon severity={alert.severity} className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-fg">{alert.title}</span>
            <Badge tone={tone}>{alert.severity}</Badge>
            <Badge tone={alert.status === 'active' ? tone : 'neutral'}>{alert.status}</Badge>
            {alert.simulated && <SimBadge />}
          </div>
          <p className="mt-1 text-sm text-fg-2">{alert.message}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-3">
            <span className="num" title={dateTime(alert.ts)}>
              Raised {ago(alert.ts, now)}
            </span>
            {deviceName && <span>{deviceName}</span>}
            {alert.acknowledgedBy && (
              <span>
                Ack: {alert.acknowledgedBy}
                {alert.acknowledgedAt && ` · ${ago(alert.acknowledgedAt, now)}`}
              </span>
            )}
            {alert.resolvedAt && <span>Resolved {ago(alert.resolvedAt, now)}</span>}
          </div>
        </div>
      </div>
      {!resolved && canAct && (
        <div className="flex shrink-0 gap-2 sm:pl-2">
          {alert.status === 'active' && (
            <Button size="sm" variant={alert.severity === 'critical' ? 'danger' : 'warn'} icon={<CheckCheck className="size-3.5" />} onClick={onAcknowledge}>
              Acknowledge
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<CircleCheck className="size-3.5" />} onClick={onResolve}>
            Resolve
          </Button>
        </div>
      )}
    </li>
  );
}
