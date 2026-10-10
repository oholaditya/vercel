import { useState } from 'react';
import { Cable, Cpu, FlaskConical, Info, LogOut, Monitor, Moon, Palette, Sun, User } from 'lucide-react';
import { api } from '../lib/api';
import { duration } from '../lib/format';
import { useAuth } from '../state/auth';
import { useHub } from '../state/hub';
import { useToast } from '../state/toast';
import { useTheme, type ThemePref } from '../theme/ThemeProvider';
import { SimulationControls } from '../components/SimulationControls';
import { Badge, Button, Card, CardHeader, PageHeader, Segmented, StatusDot, Toggle } from '../components/ui/primitives';

export function SettingsPage() {
  const hub = useHub();
  const { session, can, logout } = useAuth();
  const { pref, setPref } = useTheme();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const ov = hub.overview;

  const setSim = async (running: boolean) => {
    setBusy(true);
    try {
      await api.setSimulation(running);
      notify('success', `Simulator ${running ? 'resumed' : 'paused'}`);
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Appearance, simulation control, system diagnostics and account." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Palette className="size-4" />} eyebrow="Appearance" title="Theme" />
          <div className="space-y-3 p-4">
            <Segmented<ThemePref>
              label="Theme"
              value={pref}
              onChange={setPref}
              options={[
                { value: 'dark', label: <span className="flex items-center justify-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
                { value: 'light', label: <span className="flex items-center justify-center gap-1.5"><Sun className="size-3.5" />Light</span> },
                { value: 'system', label: <span className="flex items-center justify-center gap-1.5"><Monitor className="size-3.5" />System</span> },
              ]}
            />
            <p className="text-xs text-fg-3">Light is the default, matching the program guide palette. Your choice is stored in this browser only.</p>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<User className="size-4" />} eyebrow="Account" title={session?.user.username ?? '-'} actions={<Badge tone="accent">{session?.user.role}</Badge>} />
          <div className="space-y-3 p-4 text-sm text-fg-2">
            <ul className="space-y-1 text-xs text-fg-3">
              <li><strong className="text-fg-2">viewer</strong> - read-only dashboards, events and alerts</li>
              <li><strong className="text-fg-2">operator</strong> - control devices, acknowledge alerts, run scenarios</li>
              <li><strong className="text-fg-2">admin</strong> - manage automation rules, simulator, audit log</li>
            </ul>
            <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={logout}>
              Sign out
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<FlaskConical className="size-4 text-warn" />}
            eyebrow="Simulation"
            title="Simulated device adapter"
            actions={<Toggle checked={!!ov?.simulationRunning} disabled={!can('admin') || busy} onChange={(v) => void setSim(v)} label="Simulator running" />}
          />
          <div className="space-y-2 p-4 text-sm text-fg-2">
            <p>
              All {ov?.devicesTotal ?? ''} sample devices are driven by a software physics model. When paused, simulated devices stop sending heartbeats and will be reported{' '}
              <em>offline</em> after the heartbeat timeout - exactly how a real link failure is detected.
            </p>
            <p className="text-xs text-fg-3">{can('admin') ? 'Admin control.' : 'Admin role required to pause/resume.'}</p>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Cpu className="size-4" />} eyebrow="Diagnostics" title="System information" />
          <dl className="grid grid-cols-2 gap-px bg-line text-sm sm:grid-cols-3">
            {[
              ['Version', ov?.version],
              ['Uptime', ov ? duration(ov.uptimeSec) : '-'],
              ['Events processed', ov?.engine.processed.toLocaleString()],
              ['Avg dispatch latency', ov ? `${ov.engine.avgLatencyMs.toFixed(2)} ms` : '-'],
              ['Max dispatch latency', ov ? `${ov.engine.maxLatencyMs.toFixed(2)} ms` : '-'],
              ['Dropped (overload)', ov?.engine.dropped],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-surface px-4 py-3">
                <dt className="eyebrow">{k}</dt>
                <dd className="num mt-1 text-fg">{v ?? '-'}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line p-4">
            <div className="eyebrow mb-2 flex items-center gap-1.5">
              <Cable className="size-3" /> Adapters
            </div>
            <ul className="space-y-1.5">
              {hub.adapters.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <StatusDot tone={a.connected ? 'ok' : 'neutral'} />
                  <span className="num text-fg">{a.id}</span>
                  <Badge tone={a.origin === 'simulated' ? 'warn' : 'info'}>{a.origin}</Badge>
                  <span className="truncate text-xs text-fg-3">{a.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <SimulationControls />
      </div>

      <Card className="mt-4">
        <CardHeader icon={<Info className="size-4" />} eyebrow="About" title="What this prototype is - and is not" />
        <div className="grid gap-4 p-4 text-sm text-fg-2 md:grid-cols-2">
          <div>
            <h3 className="mb-1 font-semibold text-fg">Implemented & verified</h3>
            <p>Web console, REST API with role-based access, Socket.IO real-time updates, priority event engine, automation rules, alert lifecycle, SQLite storage, a simulated device adapter and a TCP bridge protocol for external device processes.</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-fg">Not implemented / not verified</h3>
            <p>No physical devices are connected. The native QNX Neutrino prototype in <code className="num text-xs">native/qnx</code> has not been built or run on QNX. The Node.js engine is not hard real-time. This is not a certified life-safety system.</p>
          </div>
        </div>
      </Card>
    </>
  );
}
