import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Bell, Cpu, Gauge, Radio, Workflow } from 'lucide-react';
import type { ActivityBucket } from '@shared/types';
import { api } from '../lib/api';
import { duration } from '../lib/format';
import { useDeviceList, useHub } from '../state/hub';
import { systemLabel, systemTone } from '../theme/tokens';
import { BarChart } from '../components/charts/BarChart';
import { TelemetryPanel } from '../components/charts/TelemetryPanel';
import { EmergencyPanel } from '../components/alerts/EmergencyPanel';
import { DeviceGrid } from '../components/devices/DeviceGrid';
import { EventFeed } from '../components/events/EventFeed';
import { Card, CardHeader, PageHeader, StatusDot } from '../components/ui/primitives';
import { StatTile } from '../components/ui/StatTile';

export function DashboardPage() {
  const hub = useHub();
  const devices = useDeviceList();
  const ov = hub.overview;
  const [activity, setActivity] = useState<ActivityBucket[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => api.activity(30).then((r) => alive && setActivity(r.buckets)).catch(() => undefined);
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const quick = useMemo(() => {
    const pick = ['security_panel', 'thermostat', 'light', 'co', 'smoke'];
    return devices.filter((d) => pick.includes(d.kind)).sort((a, b) => pick.indexOf(a.kind) - pick.indexOf(b.kind)).slice(0, 8);
  }, [devices]);

  const status = ov?.status ?? 'nominal';

  return (
    <>
      <PageHeader title="System overview" description="Live coordination status for every connected device, rule and alert." />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label="Connected devices"
          icon={<Cpu className="size-4" />}
          value={
            <>
              {ov?.devicesOnline ?? '-'}
              <span className="text-base font-normal text-fg-3">/{ov?.devicesTotal ?? '-'}</span>
            </>
          }
          tone={ov && ov.devicesOnline < ov.devicesTotal ? 'warn' : 'neutral'}
          sub={ov && ov.devicesOnline < ov.devicesTotal ? `${ov.devicesTotal - ov.devicesOnline} offline` : 'All devices reporting'}
        />
        <StatTile
          label="Active alerts"
          icon={<Bell className="size-4" />}
          value={ov?.activeAlerts ?? '-'}
          tone={ov?.criticalAlerts ? 'crit' : ov?.activeAlerts ? 'warn' : 'neutral'}
          sub={ov?.criticalAlerts ? `${ov.criticalAlerts} critical` : 'No critical alerts'}
        />
        <StatTile
          label="System status"
          icon={<Gauge className="size-4" />}
          value={<span className="font-sans text-lg">{systemLabel[status]}</span>}
          tone={systemTone[status]}
          sub={ov ? `Uptime ${duration(ov.uptimeSec)}` : undefined}
        />
        <StatTile label="Automation" icon={<Workflow className="size-4" />} value={hub.overview?.rulesEnabled ?? '-'} sub="rules enabled" />
      </div>

      <div className="mt-4">
        <EmergencyPanel compact />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <TelemetryPanel />
          <Card>
            <CardHeader
              icon={<Activity className="size-4" />}
              eyebrow="System activity"
              title="Events per minute · last 30 min"
              actions={
                ov && (
                  <div className="hidden items-center gap-4 text-2xs text-fg-3 sm:flex">
                    <span>
                      queue <span className="num text-fg-2">{ov.engine.queueDepth}</span>
                    </span>
                    <span>
                      max latency <span className="num text-fg-2">{ov.engine.maxLatencyMs.toFixed(1)} ms</span>
                    </span>
                    <span>
                      dropped <span className="num text-fg-2">{ov.engine.dropped}</span>
                    </span>
                  </div>
                )
              }
            />
            <div className="px-2 pt-3 pb-3">
              <BarChart buckets={activity} label="Events per minute" />
            </div>
          </Card>
        </div>
        <Card className="flex flex-col overflow-hidden">
          <CardHeader
            icon={<Radio className="size-4" />}
            eyebrow="Live monitor"
            title="Event stream"
            actions={
              <span className="flex items-center gap-1.5 text-2xs font-semibold tracking-wider text-fg-3 uppercase">
                <StatusDot tone={hub.connection === 'live' ? 'ok' : 'warn'} pulse={hub.connection === 'live'} /> {hub.connection}
              </span>
            }
          />
          <EventFeed events={hub.events} maxHeight={640} />
        </Card>
      </div>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Quick controls</h2>
        <Link to="/devices" className="flex items-center gap-1 text-xs font-medium text-accent-text hover:underline">
          All devices <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <DeviceGrid devices={quick} />
    </>
  );
}
