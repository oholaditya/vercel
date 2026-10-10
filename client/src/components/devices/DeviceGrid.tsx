import type { DeviceSnapshot } from '@shared/types';
import { useNow } from '../../hooks/useNow';
import { useAuth } from '../../state/auth';
import { useHub } from '../../state/hub';
import { DeviceCard } from './DeviceCard';

/** Device cards wired to live hub state and the validated command API. */
export function DeviceGrid({ devices, onDetails, className }: { devices: DeviceSnapshot[]; onDetails?: (id: string) => void; className?: string }) {
  const hub = useHub();
  const { can } = useAuth();
  const now = useNow(5000);
  const panel = Object.values(hub.devices).find((d) => d.kind === 'security_panel');
  const securityMode = panel ? (panel.state as { mode: 'disarmed' | 'armed_home' | 'armed_away' }).mode : undefined;

  return (
    <div className={className ?? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'}>
      {devices.map((d) => (
        <DeviceCard
          key={d.id}
          device={d}
          now={now}
          canControl={can('operator')}
          pending={hub.pending[d.id]}
          telemetry={hub.telemetry[d.id]}
          securityMode={securityMode}
          onCommand={(cmd) => hub.sendCommand(d.id, cmd)}
          onDetails={onDetails ? () => onDetails(d.id) : undefined}
        />
      ))}
    </div>
  );
}
