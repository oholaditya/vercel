import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Clock, Plus, Trash2, Workflow, X, Zap } from 'lucide-react';
import type { AutomationRule, DeviceSnapshot, NumericMetric, RuleAction, RuleTrigger } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { ago } from '../lib/format';
import { useAuth } from '../state/auth';
import { useDeviceList, useHub } from '../state/hub';
import { useToast } from '../state/toast';
import { METRIC_META } from '../theme/tokens';
import { Badge, Button, Card, EmptyState, Field, inputClass, PageHeader, Toggle } from '../components/ui/primitives';

// ---------------------------------------------------------------- human-readable rule summaries

function deviceName(devices: Record<string, DeviceSnapshot>, id?: string) {
  return id ? (devices[id]?.name ?? id) : null;
}

export function describeTrigger(t: RuleTrigger, devices: Record<string, DeviceSnapshot>): string {
  switch (t.type) {
    case 'motion':
      return `Motion detected${t.deviceId ? ` at ${deviceName(devices, t.deviceId)}` : ' by any sensor'}`;
    case 'intrusion':
      return `${t.deviceId ? deviceName(devices, t.deviceId) : 'Any door/window'} opens${t.requireArmed ? ' while armed' : ''}`;
    case 'threshold': {
      const m = METRIC_META[t.metric];
      return `${m.label} ${t.op} ${t.value} ${m.unit}${t.deviceId ? ` at ${deviceName(devices, t.deviceId)}` : ''}`;
    }
    case 'device_offline':
      return `${t.deviceId ? deviceName(devices, t.deviceId) : 'Any device'} goes offline`;
  }
}

export function describeAction(a: RuleAction, devices: Record<string, DeviceSnapshot>): string {
  switch (a.type) {
    case 'lights':
      return `Lights ${a.on ? 'on' : 'off'}${a.brightness !== undefined && a.on ? ` (${a.brightness}%)` : ''} · ${a.room === '*' ? 'all rooms' : a.room ? a.room : 'same room'}`;
    case 'raise_alert':
      return `Raise ${a.severity} alert “${a.title}”`;
    case 'activate_siren':
      return 'Sound siren';
    case 'device_command':
      return `${deviceName(devices, a.deviceId)}: ${a.command.action}${'on' in a.command ? ` ${a.command.on ? 'on' : 'off'}` : ''}${'mode' in a.command ? ` ${a.command.mode}` : ''}${'level' in a.command ? ` ${a.command.level}%` : ''}${'celsius' in a.command ? ` ${a.command.celsius} °C` : ''}`;
  }
}

// ---------------------------------------------------------------- page

export function AutomationPage() {
  const hub = useHub();
  const { can } = useAuth();
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const rules = useMemo(() => Object.values(hub.rules).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [hub.rules]);
  const isAdmin = can('admin');

  const toggle = async (r: AutomationRule, enabled: boolean) => {
    try {
      const { rule } = await api.updateRule(r.id, { enabled });
      hub.upsertRule(rule);
    } catch (err) {
      notify('error', (err as Error).message);
    }
  };

  const remove = async (r: AutomationRule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    try {
      await api.deleteRule(r.id);
      hub.removeRule(r.id);
      notify('success', 'Rule deleted');
    } catch (err) {
      notify('error', (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Automation"
        description="Event-driven rules evaluated by the coordination engine. Threshold rules are edge-triggered; every rule has a cooldown to prevent flooding."
        actions={
          isAdmin && !creating ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New rule
            </Button>
          ) : !isAdmin ? (
            <Badge tone="neutral">Read-only · admin required to edit</Badge>
          ) : null
        }
      />

      {creating && <RuleBuilder onClose={() => setCreating(false)} />}

      {rules.length === 0 ? (
        <EmptyState icon={<Workflow className="size-7" />} title="No automation rules" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rules.map((r) => (
            <Card key={r.id} as="article" className={r.enabled ? '' : 'opacity-70'}>
              <div className="flex items-start gap-3 p-4">
                <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${r.enabled ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line bg-surface-2 text-fg-3'}`}>
                  <Zap className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-fg">{r.name}</h3>
                    {!r.enabled && <Badge>Disabled</Badge>}
                  </div>
                  {r.description && <p className="mt-0.5 text-xs text-fg-3">{r.description}</p>}
                </div>
                <Toggle checked={r.enabled} disabled={!isAdmin} label={`Enable ${r.name}`} onChange={(v) => void toggle(r, v)} />
              </div>
              <div className="mx-4 grid gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm sm:grid-cols-[auto_1fr]">
                <span className="eyebrow pt-0.5 text-accent-text">When</span>
                <span className="text-fg-2">{describeTrigger(r.trigger, hub.devices)}</span>
                <span className="eyebrow pt-0.5 text-accent-text">Then</span>
                <ul className="space-y-1 text-fg-2">
                  {r.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <ArrowRight className="mt-1 size-3 shrink-0 text-fg-3" />
                      {describeAction(a, hub.devices)}
                    </li>
                  ))}
                </ul>
              </div>
              <footer className="flex items-center justify-between px-4 py-3 text-2xs text-fg-3">
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" /> cooldown <span className="num">{Math.round(r.cooldownMs / 1000)}s</span>
                  </span>
                  <span>last fired {ago(r.lastFiredAt)}</span>
                </span>
                {isAdmin && (
                  <button onClick={() => void remove(r)} className="flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-crit/10 hover:text-crit" aria-label={`Delete ${r.name}`}>
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                )}
              </footer>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- rule builder

type TriggerType = RuleTrigger['type'];
type ActionType = RuleAction['type'];

function RuleBuilder({ onClose }: { onClose: () => void }) {
  const hub = useHub();
  const devices = useDeviceList();
  const notify = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tType, setTType] = useState<TriggerType>('motion');
  const [tDevice, setTDevice] = useState('');
  const [metric, setMetric] = useState<NumericMetric>('co_ppm');
  const [op, setOp] = useState<'>' | '<'>('>');
  const [value, setValue] = useState('50');
  const [requireArmed, setRequireArmed] = useState(true);
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [cooldown, setCooldown] = useState('30');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const triggerDevices = devices.filter((d) =>
    tType === 'motion' ? d.kind === 'motion' : tType === 'intrusion' ? d.kind === 'contact' : tType === 'threshold' ? (metric === 'temperature' ? d.kind === 'thermostat' : metric === 'co_ppm' ? d.kind === 'co' : d.kind === 'smoke') : true,
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trigger: RuleTrigger =
      tType === 'threshold'
        ? { type: 'threshold', metric, op, value: Number(value), ...(tDevice ? { deviceId: tDevice } : {}) }
        : tType === 'intrusion'
          ? { type: 'intrusion', requireArmed, ...(tDevice ? { deviceId: tDevice } : {}) }
          : { type: tType, ...(tDevice ? { deviceId: tDevice } : {}) };
    setBusy(true);
    setErrors([]);
    try {
      const { rule } = await api.createRule({ name, description, trigger, actions, cooldownMs: Math.round(Number(cooldown) * 1000) });
      hub.upsertRule(rule);
      notify('success', `Rule "${rule.name}" created`);
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError && err.details ? err.details.map((d) => `${d.path || 'rule'}: ${d.message}`) : [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-5 border-accent/30">
      <form onSubmit={submit}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="eyebrow">New automation</div>
            <h2 className="text-sm font-semibold text-fg">Rule builder</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label="Cancel">
            <X className="size-4" />
          </button>
        </header>

        <div className="grid gap-5 p-4 lg:grid-cols-3">
          <div className="space-y-3">
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="e.g. Garage CO → alert" />
            </Field>
            <Field label="Description">
              <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} placeholder="Optional" />
            </Field>
            <Field label="Cooldown (seconds)">
              <input className={inputClass} type="number" min={0} max={86400} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
            <div className="eyebrow text-accent-text">When</div>
            <Field label="Trigger">
              <select className={inputClass} value={tType} onChange={(e) => { setTType(e.target.value as TriggerType); setTDevice(''); }}>
                <option value="motion">Motion detected</option>
                <option value="intrusion">Door / window opened</option>
                <option value="threshold">Sensor threshold</option>
                <option value="device_offline">Device disconnected</option>
              </select>
            </Field>
            {tType === 'threshold' && (
              <div className="grid grid-cols-[1fr_auto_5rem] gap-2">
                <select className={inputClass} value={metric} onChange={(e) => { setMetric(e.target.value as NumericMetric); setTDevice(''); }} aria-label="Metric">
                  <option value="co_ppm">CO (ppm)</option>
                  <option value="obscuration">Smoke (%/m)</option>
                  <option value="temperature">Temperature (°C)</option>
                </select>
                <select className={inputClass} value={op} onChange={(e) => setOp(e.target.value as '>' | '<')} aria-label="Operator">
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                </select>
                <input className={inputClass} type="number" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Threshold value" />
              </div>
            )}
            {tType === 'intrusion' && (
              <label className="flex items-center justify-between text-sm text-fg-2">
                Only while system is armed
                <Toggle size="sm" checked={requireArmed} onChange={setRequireArmed} label="Only while armed" />
              </label>
            )}
            <Field label="Device (optional)">
              <select className={inputClass} value={tDevice} onChange={(e) => setTDevice(e.target.value)}>
                <option value="">Any matching device</option>
                {triggerDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
            <div className="eyebrow text-accent-text">Then</div>
            {actions.length === 0 && <p className="text-xs text-fg-3">Add at least one action.</p>}
            <ul className="space-y-1.5">
              {actions.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-fg-2">
                  <span className="min-w-0 truncate">{describeAction(a, hub.devices)}</span>
                  <button type="button" onClick={() => setActions(actions.filter((_, j) => j !== i))} className="text-fg-3 hover:text-crit" aria-label="Remove action">
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {actions.length < 8 && <ActionAdder devices={devices} onAdd={(a) => setActions([...actions, a])} />}
          </div>
        </div>

        {errors.length > 0 && (
          <div role="alert" className="mx-4 mb-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name || actions.length === 0}>
            Create rule
          </Button>
        </footer>
      </form>
    </Card>
  );
}

function ActionAdder({ devices, onAdd }: { devices: DeviceSnapshot[]; onAdd: (a: RuleAction) => void }) {
  const [type, setType] = useState<ActionType>('raise_alert');
  const [severity, setSeverity] = useState<'warning' | 'critical'>('warning');
  const [title, setTitle] = useState('');
  const [room, setRoom] = useState('');
  const [on, setOn] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const rooms = [...new Set(devices.map((d) => d.room))].sort();
  const lights = devices.filter((d) => d.kind === 'light' || d.kind === 'thermostat');

  const add = () => {
    if (type === 'raise_alert') {
      if (!title.trim()) return;
      onAdd({ type, severity, category: 'threshold', title: title.trim() });
      setTitle('');
    } else if (type === 'lights') onAdd({ type, on, ...(room ? { room } : {}) });
    else if (type === 'activate_siren') onAdd({ type });
    else if (type === 'device_command' && deviceId) onAdd({ type, deviceId, command: { action: 'setPower', on } });
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as ActionType)} aria-label="Action type">
        <option value="raise_alert">Raise alert</option>
        <option value="lights">Switch lights</option>
        <option value="device_command">Switch a device on/off</option>
        <option value="activate_siren">Sound siren</option>
      </select>
      {type === 'raise_alert' && (
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value as 'warning' | 'critical')} aria-label="Severity">
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <input className={inputClass} placeholder="Alert title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Alert title" />
        </div>
      )}
      {type === 'lights' && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select className={inputClass} value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Room">
            <option value="">Same room as trigger</option>
            <option value="*">All rooms</option>
            {rooms.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select className={inputClass} value={on ? 'on' : 'off'} onChange={(e) => setOn(e.target.value === 'on')} aria-label="Power">
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      )}
      {type === 'device_command' && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Device">
            <option value="">Select device…</option>
            {lights.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select className={inputClass} value={on ? 'on' : 'off'} onChange={(e) => setOn(e.target.value === 'on')} aria-label="Power">
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      )}
      <Button type="button" size="sm" icon={<Plus className="size-3.5" />} onClick={add} className="w-full">
        Add action
      </Button>
    </div>
  );
}
