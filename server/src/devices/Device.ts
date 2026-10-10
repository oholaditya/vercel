import type {
  CoState,
  ContactState,
  DataOrigin,
  DeviceCommand,
  DeviceHealth,
  DeviceKind,
  DeviceSnapshot,
  DeviceStateMap,
  LightState,
  MotionState,
  SecurityPanelState,
  SensorReading,
  SmokeState,
  ThermostatState,
} from '../domain/types.js';

/** Raised when a command is not valid for the target device (maps to HTTP 422). */
export class CommandError extends Error {
  constructor(message: string, readonly code: 'UNSUPPORTED' | 'INVALID' | 'OFFLINE' | 'NOT_FOUND' = 'INVALID') {
    super(message);
    this.name = 'CommandError';
  }
}

/** Device-local alarm thresholds (what a detector would itself signal). Simulation values only. */
export const SMOKE_ALARM_OBSCURATION = 10; // %/m
export const CO_ALARM_PPM = 70;

export interface DeviceInit<K extends DeviceKind> {
  id: string;
  name: string;
  room: string;
  adapterId: string;
  origin: DataOrigin;
  state: DeviceStateMap[K];
}

/**
 * Device Abstraction Layer base class.
 *
 * A Device is a pure in-memory model: it validates commands (`planCommand`) and
 * applies readings (`ingest`). It never talks to hardware - transports are the
 * job of a DeviceAdapter. This keeps device logic deterministic and unit-testable.
 */
export abstract class Device<K extends DeviceKind = DeviceKind> {
  abstract readonly kind: K;
  readonly id: string;
  name: string;
  room: string;
  readonly adapterId: string;
  readonly origin: DataOrigin;
  online = true;
  health: DeviceHealth = 'ok';
  battery: number | null = null;
  lastSeen: string | null = null;
  protected _state: DeviceStateMap[K];

  constructor(init: DeviceInit<K>) {
    this.id = init.id;
    this.name = init.name;
    this.room = init.room;
    this.adapterId = init.adapterId;
    this.origin = init.origin;
    this._state = { ...init.state };
  }

  get state(): DeviceStateMap[K] {
    return this._state;
  }

  /** Returns the state that would result from the command, or throws CommandError. Does not mutate. */
  planCommand(command: DeviceCommand): DeviceStateMap[K] {
    throw new CommandError(`"${command.action}" is not supported by ${this.kind} devices`, 'UNSUPPORTED');
  }

  commit(next: DeviceStateMap[K]): void {
    this._state = { ...next };
  }

  /** Applies a validated reading. Returns true if the observable state changed. */
  ingest(reading: SensorReading): boolean {
    if (reading.metric === 'battery') {
      const changed = this.battery !== reading.value;
      this.battery = Math.round(reading.value);
      this.health = this.battery < 15 ? 'degraded' : this.health === 'degraded' ? 'ok' : this.health;
      return changed;
    }
    return this.ingestMetric(reading);
  }

  protected ingestMetric(_reading: SensorReading): boolean {
    return false;
  }

  snapshot(): DeviceSnapshot<K> {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      room: this.room,
      origin: this.origin,
      adapterId: this.adapterId,
      online: this.online,
      health: this.health,
      battery: this.battery,
      lastSeen: this.lastSeen,
      state: { ...this._state },
    };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export class LightDevice extends Device<'light'> {
  readonly kind = 'light' as const;

  override planCommand(c: DeviceCommand): LightState {
    switch (c.action) {
      case 'setPower':
        return { ...this._state, on: c.on, brightness: c.on && this._state.brightness === 0 ? 100 : this._state.brightness };
      case 'setBrightness':
        if (!Number.isInteger(c.level) || c.level < 0 || c.level > 100) {
          throw new CommandError('Brightness must be an integer between 0 and 100');
        }
        return { on: c.level > 0, brightness: c.level };
      default:
        return super.planCommand(c);
    }
  }
}

export const THERMOSTAT_MIN_C = 10;
export const THERMOSTAT_MAX_C = 30;

export class ThermostatDevice extends Device<'thermostat'> {
  readonly kind = 'thermostat' as const;

  override planCommand(c: DeviceCommand): ThermostatState {
    switch (c.action) {
      case 'setTarget':
        if (!Number.isFinite(c.celsius) || c.celsius < THERMOSTAT_MIN_C || c.celsius > THERMOSTAT_MAX_C) {
          throw new CommandError(`Target must be between ${THERMOSTAT_MIN_C} and ${THERMOSTAT_MAX_C} °C`);
        }
        return this.withDemand({ ...this._state, targetC: Math.round(c.celsius * 2) / 2 });
      case 'setMode':
        return this.withDemand({ ...this._state, mode: c.mode });
      case 'setPower':
        return this.withDemand({ ...this._state, mode: c.on ? 'auto' : 'off' });
      default:
        return super.planCommand(c);
    }
  }

  protected override ingestMetric(r: SensorReading): boolean {
    if (r.metric !== 'temperature') return false;
    const next = this.withDemand({ ...this._state, currentC: round1(r.value) });
    const changed = JSON.stringify(next) !== JSON.stringify(this._state);
    this._state = next;
    return changed;
  }

  /** Simple hysteresis controller (0.3 °C dead band). */
  private withDemand(s: ThermostatState): ThermostatState {
    const band = 0.3;
    const canHeat = s.mode === 'heat' || s.mode === 'auto';
    const canCool = s.mode === 'cool' || s.mode === 'auto';
    return {
      ...s,
      heating: canHeat && s.currentC < s.targetC - band,
      cooling: canCool && s.currentC > s.targetC + band,
    };
  }
}

export class SmokeSensor extends Device<'smoke'> {
  readonly kind = 'smoke' as const;
  protected override ingestMetric(r: SensorReading): boolean {
    if (r.metric !== 'obscuration') return false;
    const next: SmokeState = { obscuration: round1(r.value), alarm: r.value >= SMOKE_ALARM_OBSCURATION };
    const changed = next.obscuration !== this._state.obscuration || next.alarm !== this._state.alarm;
    this._state = next;
    return changed;
  }
}

export class CoSensor extends Device<'co'> {
  readonly kind = 'co' as const;
  protected override ingestMetric(r: SensorReading): boolean {
    if (r.metric !== 'co_ppm') return false;
    const next: CoState = { ppm: Math.round(r.value), alarm: r.value >= CO_ALARM_PPM };
    const changed = next.ppm !== this._state.ppm || next.alarm !== this._state.alarm;
    this._state = next;
    return changed;
  }
}

export class ContactSensor extends Device<'contact'> {
  readonly kind = 'contact' as const;
  protected override ingestMetric(r: SensorReading): boolean {
    if (r.metric !== 'contact_open') return false;
    const changed = this._state.open !== r.value;
    this._state = { open: r.value } satisfies ContactState;
    return changed;
  }
}

export class MotionSensor extends Device<'motion'> {
  readonly kind = 'motion' as const;
  protected override ingestMetric(r: SensorReading): boolean {
    if (r.metric !== 'motion') return false;
    const changed = this._state.motion !== r.value;
    this._state = {
      motion: r.value,
      lastMotionAt: r.value ? new Date().toISOString() : this._state.lastMotionAt,
    } satisfies MotionState;
    return changed;
  }
}

export class SecurityPanel extends Device<'security_panel'> {
  readonly kind = 'security_panel' as const;

  override planCommand(c: DeviceCommand): SecurityPanelState {
    switch (c.action) {
      case 'setSecurityMode':
        // Disarming always silences the siren.
        return { mode: c.mode, sirenActive: c.mode === 'disarmed' ? false : this._state.sirenActive };
      case 'silenceSiren':
        return { ...this._state, sirenActive: false };
      default:
        return super.planCommand(c);
    }
  }

  /** Internal (automation-only) transition: not exposed as a user command. */
  activateSiren(): boolean {
    if (this._state.sirenActive) return false;
    this._state = { ...this._state, sirenActive: true };
    return true;
  }
}

export function createDevice(kind: DeviceKind, init: DeviceInit<DeviceKind>): Device {
  switch (kind) {
    case 'light': return new LightDevice(init as DeviceInit<'light'>);
    case 'thermostat': return new ThermostatDevice(init as DeviceInit<'thermostat'>);
    case 'smoke': return new SmokeSensor(init as DeviceInit<'smoke'>);
    case 'co': return new CoSensor(init as DeviceInit<'co'>);
    case 'contact': return new ContactSensor(init as DeviceInit<'contact'>);
    case 'motion': return new MotionSensor(init as DeviceInit<'motion'>);
    case 'security_panel': return new SecurityPanel(init as DeviceInit<'security_panel'>);
  }
}

/** Which metric a sensor kind reports (used for telemetry history). */
export const PRIMARY_METRIC: Partial<Record<DeviceKind, 'temperature' | 'obscuration' | 'co_ppm'>> = {
  thermostat: 'temperature',
  smoke: 'obscuration',
  co: 'co_ppm',
};
