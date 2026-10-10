import { useEffect, useState, type ReactNode } from 'react';
import { BatteryLow, BatteryMedium, Flame, Minus, Plus, Siren, Snowflake, WifiOff, Info } from 'lucide-react';
import type {
  CoState,
  ContactState,
  DeviceCommand,
  DeviceSnapshot,
  LightState,
  MotionState,
  SecurityMode,
  SecurityPanelState,
  SmokeState,
  TelemetryPoint,
  ThermostatMode,
  ThermostatState,
} from '@shared/types';
import { ago } from '../../lib/format';
import { kindLabel, type Tone, toneText } from '../../theme/tokens';
import { Sparkline } from '../charts/Sparkline';
import { Badge, Button, cx, Segmented, SimBadge, StatusDot, Toggle } from '../ui/primitives';
import { DeviceIcon } from './DeviceIcon';

export interface DeviceCardProps {
  device: DeviceSnapshot;
  onCommand: (cmd: DeviceCommand) => Promise<boolean> | void;
  canControl: boolean;
  pending?: boolean;
  telemetry?: TelemetryPoint[];
  securityMode?: SecurityMode;
  now?: number;
  onDetails?: () => void;
}

/** Derive the card's headline tone: alarm > offline > active > idle. */
function cardTone(d: DeviceSnapshot, securityMode?: SecurityMode): { tone: Tone | null; active: boolean } {
  if (!d.online) return { tone: 'neutral', active: false };
  switch (d.kind) {
    case 'light':
      return { tone: null, active: (d.state as LightState).on };
    case 'thermostat': {
      const s = d.state as ThermostatState;
      return { tone: null, active: s.heating || s.cooling };
    }
    case 'smoke':
      return { tone: (d.state as SmokeState).alarm ? 'crit' : null, active: false };
    case 'co': {
      const ppm = (d.state as CoState).ppm;
      return { tone: ppm >= 70 ? 'crit' : ppm > 35 ? 'warn' : null, active: false };
    }
    case 'contact':
      return { tone: (d.state as ContactState).open ? (securityMode && securityMode !== 'disarmed' ? 'crit' : 'warn') : null, active: false };
    case 'motion':
      return { tone: null, active: (d.state as MotionState).motion };
    case 'security_panel': {
      const s = d.state as SecurityPanelState;
      return { tone: s.sirenActive ? 'crit' : null, active: s.mode !== 'disarmed' };
    }
  }
}

export function DeviceCard(props: DeviceCardProps) {
  const { device: d, securityMode, now = Date.now(), onDetails } = props;
  const { tone, active } = cardTone(d, securityMode);
  const alarm = tone === 'crit';

  return (
    <article
      aria-label={`${d.name}, ${kindLabel[d.kind]}`}
      className={cx(
        'group relative flex flex-col rounded-xl border bg-surface shadow-card transition-[border-color,transform] duration-200 hover:-translate-y-px',
        alarm ? 'border-crit/60' : tone === 'warn' ? 'border-warn/50' : active ? 'border-ok/40' : 'border-line hover:border-line-strong',
        !d.online && 'opacity-75',
      )}
    >
      {/* Status rail */}
      <span
        aria-hidden
        className={cx(
          'absolute inset-x-4 top-0 h-px',
          alarm ? 'bg-crit' : tone === 'warn' ? 'bg-warn' : active ? 'bg-ok' : 'bg-transparent',
        )}
      />
      <header className="flex items-start gap-3 px-4 pt-4">
        <div
          className={cx(
            'flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
            alarm ? 'border-crit/40 bg-crit/10 text-crit' : tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : active ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-surface-2 text-fg-3',
          )}
        >
          <DeviceIcon kind={d.kind} open={d.kind === 'contact' && (d.state as ContactState).open} className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-fg">{d.name}</h3>
            {d.origin === 'simulated' && <SimBadge />}
          </div>
          <div className="mt-0.5 truncate text-xs text-fg-3">
            {d.room} · {kindLabel[d.kind]}
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-0.5" title={d.online ? `Online - last heartbeat ${ago(d.lastSeen, now)}` : 'Offline - no heartbeat'}>
          {d.online ? <StatusDot tone={d.health === 'ok' ? 'ok' : d.health === 'degraded' ? 'warn' : 'crit'} /> : <WifiOff className="size-3.5 text-fg-3" />}
          <span className={cx('text-2xs font-medium uppercase tracking-wide', d.online ? (d.health === 'ok' ? 'text-fg-3' : d.health === 'degraded' ? 'text-warn' : 'text-crit') : 'text-fg-3')}>
            {d.online ? (d.health === 'ok' ? 'Online' : d.health) : 'Offline'}
          </span>
        </div>
      </header>

      <div className="flex-1 px-4 pt-3 pb-4">
        <Body {...props} />
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-2xs text-fg-3">
        <span className="num">{d.id}</span>
        <span className="flex items-center gap-3">
          {d.battery !== null && (
            <span className={cx('flex items-center gap-1', d.battery < 15 && 'text-warn')} title="Battery level">
              {d.battery < 30 ? <BatteryLow className="size-3.5" /> : <BatteryMedium className="size-3.5" />}
              <span className="num">{Math.round(d.battery)}%</span>
            </span>
          )}
          {onDetails && (
            <button onClick={onDetails} className="flex items-center gap-1 rounded px-1 text-fg-3 transition-colors hover:text-accent-text" aria-label={`Details for ${d.name}`}>
              <Info className="size-3.5" /> Details
            </button>
          )}
        </span>
      </footer>
    </article>
  );
}

function Body(p: DeviceCardProps) {
  switch (p.device.kind) {
    case 'light':
      return <LightBody {...p} />;
    case 'thermostat':
      return <ThermostatBody {...p} />;
    case 'smoke':
      return <SafetyBody {...p} metric="smoke" />;
    case 'co':
      return <SafetyBody {...p} metric="co" />;
    case 'contact':
      return <ContactBody {...p} />;
    case 'motion':
      return <MotionBody {...p} />;
    case 'security_panel':
      return <PanelBody {...p} />;
  }
}

const disabledReason = (p: DeviceCardProps) => (!p.device.online ? 'Device offline' : !p.canControl ? 'Read-only role' : undefined);

// ---------------------------------------------------------------- Light

export function LightBody({ device, onCommand, canControl, pending }: DeviceCardProps) {
  const s = device.state as LightState;
  const [level, setLevel] = useState(s.brightness);
  useEffect(() => setLevel(s.brightness), [s.brightness]);
  const disabled = !device.online || !canControl || pending;
  const commit = () => level !== s.brightness && void onCommand({ action: 'setBrightness', level });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className={cx('text-lg font-semibold', s.on ? 'text-fg' : 'text-fg-3')}>{s.on ? 'On' : 'Off'}</div>
          <div className="num text-xs text-fg-3">{s.on ? `${s.brightness}% brightness` : 'Standby'}</div>
        </div>
        <Toggle checked={s.on} disabled={disabled} label={`Power ${device.name}`} onChange={(on) => void onCommand({ action: 'setPower', on })} />
      </div>
      <div title={disabledReason({ device, onCommand, canControl })}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="eyebrow">Brightness</span>
          <span className="num text-xs text-fg-2">{level}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={level}
          disabled={disabled}
          aria-label={`Brightness ${device.name}`}
          className="range"
          style={{ ['--fill' as string]: `${level}%` }}
          onChange={(e) => setLevel(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Thermostat

const MODES: Array<{ value: ThermostatMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'heat', label: 'Heat' },
  { value: 'cool', label: 'Cool' },
  { value: 'auto', label: 'Auto' },
];

export function ThermostatBody({ device, onCommand, canControl, pending, telemetry }: DeviceCardProps) {
  const s = device.state as ThermostatState;
  const disabled = !device.online || !canControl || pending;
  const step = (delta: number) => {
    const next = Math.min(30, Math.max(10, s.targetC + delta));
    if (next !== s.targetC) void onCommand({ action: 'setTarget', celsius: next });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Current</div>
          <div className="num text-3xl leading-none font-semibold text-fg">
            {s.currentC.toFixed(1)}
            <span className="ml-0.5 text-base font-normal text-fg-3">°C</span>
          </div>
          <div className="mt-1.5">
            {s.heating ? (
              <Badge tone="neutral" icon={<Flame className="size-3 text-warn" />}>Heating</Badge>
            ) : s.cooling ? (
              <Badge tone="neutral" icon={<Snowflake className="size-3 text-info" />}>Cooling</Badge>
            ) : (
              <Badge tone="neutral">{s.mode === 'off' ? 'Off' : 'Holding'}</Badge>
            )}
          </div>
        </div>
        {telemetry && <Sparkline points={telemetry.slice(-40)} />}
      </div>
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-2 py-1.5">
        <button
          className="flex size-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-40"
          onClick={() => step(-0.5)}
          disabled={disabled || s.targetC <= 10}
          aria-label="Decrease target temperature"
        >
          <Minus className="size-4" />
        </button>
        <div className="text-center">
          <div className="eyebrow">Target</div>
          <div className="num text-base font-semibold text-accent-text">{s.targetC.toFixed(1)} °C</div>
        </div>
        <button
          className="flex size-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-40"
          onClick={() => step(0.5)}
          disabled={disabled || s.targetC >= 30}
          aria-label="Increase target temperature"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <Segmented<ThermostatMode> label={`Mode ${device.name}`} size="sm" value={s.mode} options={MODES} disabled={disabled} onChange={(mode) => void onCommand({ action: 'setMode', mode })} />
    </div>
  );
}

// ---------------------------------------------------------------- Smoke / CO

const SAFETY = {
  smoke: { unit: '%/m', warn: 5, crit: 10, max: 25, digits: 1, read: (s: unknown) => (s as SmokeState).obscuration },
  co: { unit: 'ppm', warn: 35, crit: 70, max: 150, digits: 0, read: (s: unknown) => (s as CoState).ppm },
};

export function SafetyBody({ device, telemetry, metric }: DeviceCardProps & { metric: 'smoke' | 'co' }) {
  const cfg = SAFETY[metric];
  const v = cfg.read(device.state);
  const tone: Tone = v >= cfg.crit ? 'crit' : v > cfg.warn ? 'warn' : 'ok';
  const label = tone === 'crit' ? 'Alarm' : tone === 'warn' ? 'Elevated' : 'Clear';
  const pct = (x: number) => `${Math.min(100, (x / cfg.max) * 100)}%`;
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="num text-3xl leading-none font-semibold text-fg">
            {v.toFixed(cfg.digits)}
            <span className="ml-1 text-sm font-normal text-fg-3">{cfg.unit}</span>
          </div>
          <div className={cx('mt-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', toneText[tone])}>
            <StatusDot tone={tone} pulse={tone === 'crit'} />
            {label}
          </div>
        </div>
        {telemetry && <Sparkline points={telemetry.slice(-40)} threshold={cfg.crit} />}
      </div>
      <div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className={cx('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', tone === 'crit' ? 'bg-crit' : tone === 'warn' ? 'bg-warn' : 'bg-ok')} style={{ width: pct(v) }} />
        </div>
        <div className="relative mt-1 h-3 text-[10px] text-fg-3">
          <span className="num absolute -translate-x-1/2 text-warn" style={{ left: pct(cfg.warn) }}>
            ▲{cfg.warn}
          </span>
          <span className="num absolute -translate-x-1/2 text-crit" style={{ left: pct(cfg.crit) }}>
            ▲{cfg.crit}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Contact / motion

function BigState({ tone, title, sub }: { tone: Tone; title: string; sub: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <StatusDot tone={tone} pulse={tone === 'crit'} />
      <div>
        <div className={cx('text-lg font-semibold', tone === 'neutral' ? 'text-fg' : toneText[tone])}>{title}</div>
        <div className="text-xs text-fg-3">{sub}</div>
      </div>
    </div>
  );
}

export function ContactBody({ device, securityMode }: DeviceCardProps) {
  const open = (device.state as ContactState).open;
  const armed = securityMode && securityMode !== 'disarmed';
  return (
    <BigState
      tone={open ? (armed ? 'crit' : 'warn') : 'ok'}
      title={open ? 'Open' : 'Closed'}
      sub={open ? (armed ? 'Breach while armed' : 'System disarmed') : 'Secure'}
    />
  );
}

export function MotionBody({ device, now }: DeviceCardProps) {
  const s = device.state as MotionState;
  return <BigState tone={s.motion ? 'ok' : 'neutral'} title={s.motion ? 'Motion detected' : 'No motion'} sub={`Last activity ${ago(s.lastMotionAt, now)}`} />;
}

// ---------------------------------------------------------------- Security panel

const SEC_MODES: Array<{ value: SecurityMode; label: string; tone?: Tone }> = [
  { value: 'disarmed', label: 'Disarmed' },
  { value: 'armed_home', label: 'Home', tone: 'ok' },
  { value: 'armed_away', label: 'Away', tone: 'ok' },
];

export function PanelBody({ device, onCommand, canControl, pending }: DeviceCardProps) {
  const s = device.state as SecurityPanelState;
  const disabled = !device.online || !canControl || pending;
  return (
    <div className="space-y-3">
      {s.sirenActive ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-crit">
            <Siren className="size-4" /> Siren active
          </span>
          <Button size="sm" variant="danger" disabled={disabled} onClick={() => void onCommand({ action: 'silenceSiren' })}>
            Silence
          </Button>
        </div>
      ) : (
        <BigState tone={s.mode === 'disarmed' ? 'neutral' : 'ok'} title={s.mode === 'disarmed' ? 'Disarmed' : s.mode === 'armed_home' ? 'Armed · Home' : 'Armed · Away'} sub="Siren idle" />
      )}
      <Segmented<SecurityMode> label="Security mode" size="sm" value={s.mode} options={SEC_MODES} disabled={disabled} onChange={(mode) => void onCommand({ action: 'setSecurityMode', mode })} />
    </div>
  );
}
