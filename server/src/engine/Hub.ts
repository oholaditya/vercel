import { EventEmitter } from 'node:events';
import type {
  Alert,
  AutomationRule,
  DeviceCommand,
  DeviceKind,
  DeviceSnapshot,
  HubEvent,
  NumericMetric,
  SecurityMode,
  SimulationScenario,
  SystemOverview,
  TelemetryPoint,
} from '../domain/types.js';
import { SensorReadingSchema } from '../domain/schemas.js';
import type { Repositories } from '../db/repositories.js';
import { CommandError, createDevice, SecurityPanel, type Device } from '../devices/Device.js';
import { DeviceUnreachableError, type AdapterSink, type DeviceAdapter } from '../devices/adapters/DeviceAdapter.js';
import type { SimulatedAdapter } from '../devices/adapters/SimulatedAdapter.js';
import { AlertManager } from './AlertManager.js';
import { AutomationEngine } from './AutomationEngine.js';
import { EventEngine, type EventInput } from './EventEngine.js';

export const VERSION = '1.0.0';

const NUMERIC_METRICS = new Set<NumericMetric>(['temperature', 'obscuration', 'co_ppm']);

interface HubEvents {
  device: [DeviceSnapshot];
  event: [HubEvent];
  alert: [Alert];
  rule: [AutomationRule];
  ruleDeleted: [string];
  telemetry: [{ deviceId: string; metric: NumericMetric; point: TelemetryPoint }];
}

export interface HubOptions {
  repos: Repositories;
  heartbeatTimeoutMs: number;
  /** Persist every Nth numeric reading per device (1 = all). */
  readingPersistEvery?: number;
  /** Cap on stored events (oldest pruned). */
  maxStoredEvents?: number;
}

/**
 * Coordination layer. Owns the device registry and wires together:
 * adapters (communication) -> validation -> device models (DAL) -> event engine
 * -> automation + alerts -> storage + realtime fan-out.
 */
export class Hub extends EventEmitter<HubEvents> {
  readonly engine = new EventEngine();
  readonly alerts: AlertManager;
  readonly automation: AutomationEngine;
  private readonly devices = new Map<string, Device>();
  private readonly adapters = new Map<string, DeviceAdapter>();
  private readonly startedAt = Date.now();
  private readonly readingCounter = new Map<string, number>();
  private readonly seen = new Set<string>();
  private watchdog: NodeJS.Timeout | null = null;
  private maintenance: NodeJS.Timeout | null = null;
  simulator: SimulatedAdapter | null = null;

  constructor(private readonly opts: HubOptions) {
    super();
    const { repos } = opts;
    for (const rec of repos.devices.all()) {
      const d = createDevice(rec.kind, {
        id: rec.id, name: rec.name, room: rec.room, adapterId: rec.adapterId, origin: rec.origin,
        state: rec.state as never,
      });
      d.online = false; // until the first heartbeat arrives
      this.devices.set(d.id, d);
    }

    this.alerts = new AlertManager(repos.alerts, this.engine);
    this.alerts.on('upsert', (a) => this.emit('alert', a));

    this.automation = new AutomationEngine(repos.rules, this.engine, {
      devices: () => this.listDevices(),
      securityMode: () => this.securityMode(),
      executeCommand: (id, cmd, actor) => this.executeCommand(id, cmd, actor),
      raiseAlert: (input) => void this.alerts.raise(input),
      activateSiren: (reason, simulated) => this.activateSiren(reason, simulated),
    });
    this.automation.on('upsert', (r) => this.emit('rule', r));
    this.automation.on('delete', (id) => this.emit('ruleDeleted', id));

    // Engine subscribers run in priority order for every event.
    this.engine.subscribe((e) => {
      if (e.type !== 'device.reading') repos.events.insert(e);
    });
    this.engine.subscribe((e) => this.automation.evaluate(e).then(() => undefined));
    this.engine.subscribe((e) => {
      if (e.type !== 'device.reading') this.emit('event', e);
    });
  }

  // ---------------------------------------------------------------- lifecycle

  async addAdapter(adapter: DeviceAdapter): Promise<void> {
    this.adapters.set(adapter.id, adapter);
    await adapter.start(this.sinkFor(adapter));
  }

  start(): void {
    this.publish({ type: 'system', priority: 'normal', source: 'system', deviceId: null, message: `Hub v${VERSION} started`, simulated: false });
    this.watchdog = setInterval(() => this.checkHeartbeats(), Math.max(1000, Math.floor(this.opts.heartbeatTimeoutMs / 3)));
    this.watchdog.unref?.();
    this.maintenance = setInterval(() => this.housekeeping(), 60_000);
    this.maintenance.unref?.();
  }

  async stop(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.maintenance) clearInterval(this.maintenance);
    for (const a of this.adapters.values()) await a.stop();
    await this.engine.idle();
  }

  // ---------------------------------------------------------------- queries

  listDevices(): DeviceSnapshot[] {
    return [...this.devices.values()].map((d) => d.snapshot());
  }

  getDevice(id: string): DeviceSnapshot | null {
    return this.devices.get(id)?.snapshot() ?? null;
  }

  securityMode(): SecurityMode {
    const panel = [...this.devices.values()].find((d): d is SecurityPanel => d instanceof SecurityPanel);
    return panel?.state.mode ?? 'disarmed';
  }

  adapterStatus() {
    return [...this.adapters.values()].map((a) => ({ id: a.id, origin: a.origin, ...a.status() }));
  }

  overview(): SystemOverview {
    const devices = this.listDevices();
    const counts = this.alerts.openCounts();
    const online = devices.filter((d) => d.online).length;
    const status: SystemOverview['status'] =
      counts.critical > 0 ? 'critical' : counts.total > 0 || online < devices.length ? 'degraded' : 'nominal';
    return {
      status,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      devicesTotal: devices.length,
      devicesOnline: online,
      activeAlerts: counts.total,
      criticalAlerts: counts.critical,
      rulesEnabled: this.automation.enabledCount(),
      simulationRunning: this.simulator?.isRunning() ?? false,
      engine: this.engine.getStats(),
      version: VERSION,
    };
  }

  // ---------------------------------------------------------------- commands

  /**
   * Validated command path used by both the API and automation:
   * device model validates -> adapter transmits -> state committed -> event + persist.
   */
  async executeCommand(deviceId: string, command: DeviceCommand, actor: string): Promise<DeviceSnapshot> {
    const device = this.devices.get(deviceId);
    const simulated = device?.origin === 'simulated';
    try {
      if (!device) throw new CommandError(`Device "${deviceId}" not found`, 'NOT_FOUND');
      if (!device.online) throw new CommandError(`${device.name} is offline`, 'OFFLINE');
      const next = device.planCommand(command);
      const adapter = this.adapters.get(device.adapterId);
      if (!adapter) throw new CommandError(`No adapter "${device.adapterId}" for ${device.name}`, 'OFFLINE');
      await adapter.sendCommand(device.snapshot(), command);
      device.commit(next);
    } catch (err) {
      const e = err instanceof DeviceUnreachableError ? new CommandError(err.message, 'OFFLINE') : err;
      this.publish({
        type: 'device.command_failed', priority: 'high', source: actor.startsWith('automation') ? 'automation' : 'user',
        deviceId: device ? deviceId : null, message: `Command ${command.action} failed: ${(e as Error).message}`,
        simulated, data: { actor, command },
      });
      this.opts.repos.audit.log(actor, `command:${command.action}:${deviceId}`, 'failed', (e as Error).message);
      throw e;
    }

    this.opts.repos.devices.saveState(device.id, device.state);
    const snap = device.snapshot();
    this.emit('device', snap);
    const isSecurity = command.action === 'setSecurityMode' || command.action === 'silenceSiren';
    this.publish({
      type: isSecurity ? 'security.mode' : 'device.command',
      priority: isSecurity ? 'high' : 'normal',
      source: actor.startsWith('automation') ? 'automation' : 'user',
      deviceId, message: `${device.name}: ${describeCommand(command)} (by ${actor})`,
      simulated, data: { actor, command },
    });
    if (!actor.startsWith('automation')) {
      this.opts.repos.audit.log(actor, `command:${command.action}:${deviceId}`, 'success', JSON.stringify(command));
    }
    return snap;
  }

  activateSiren(reason: string, simulated: boolean): void {
    for (const d of this.devices.values()) {
      if (d instanceof SecurityPanel && d.activateSiren()) {
        this.opts.repos.devices.saveState(d.id, d.state);
        this.emit('device', d.snapshot());
        this.publish({
          type: 'security.mode', priority: 'critical', source: 'security', deviceId: d.id,
          message: `Siren activated: ${reason}`, simulated,
        });
      }
    }
  }

  runScenario(scenario: SimulationScenario, deviceId: string | undefined, actor: string): string {
    if (!this.simulator) throw new Error('Simulation adapter is not enabled');
    if (deviceId && !this.devices.has(deviceId)) throw new CommandError(`Device "${deviceId}" not found`, 'NOT_FOUND');
    const description = this.simulator.runScenario(scenario, deviceId);
    this.publish({
      type: 'system', priority: 'normal', source: 'user', deviceId: deviceId ?? null,
      message: `[SIMULATION] ${description} (by ${actor})`, simulated: true, data: { scenario },
    });
    return description;
  }

  setSimulationRunning(on: boolean, actor: string): void {
    if (!this.simulator) throw new Error('Simulation adapter is not enabled');
    this.simulator.setRunning(on);
    this.publish({
      type: 'system', priority: 'normal', source: 'user', deviceId: null,
      message: `[SIMULATION] Simulator ${on ? 'resumed' : 'paused'} by ${actor}`, simulated: true,
    });
  }

  publish(input: EventInput): HubEvent {
    return this.engine.publish(input);
  }

  // ---------------------------------------------------------------- ingestion

  /** Validate and apply one raw reading coming from an adapter. Exposed for tests. */
  ingestReading(deviceId: string, raw: unknown, simulated: boolean): boolean {
    const device = this.devices.get(deviceId);
    if (!device) {
      this.opts.repos.audit.log('adapter', 'reading', 'denied', `unknown device ${deviceId}`);
      return false;
    }
    const parsed = SensorReadingSchema.safeParse(raw);
    if (!parsed.success) {
      device.health = 'fault';
      this.emit('device', device.snapshot());
      this.opts.repos.audit.log('adapter', `reading:${deviceId}`, 'denied', `rejected implausible reading ${safeJson(raw)}`);
      this.publish({
        type: 'system', priority: 'high', source: 'device', deviceId,
        message: `${device.name}: rejected invalid sensor reading`, simulated, data: { raw: safeJson(raw) },
      });
      return false;
    }
    const reading = parsed.data;
    this.touch(device);
    if (device.health === 'fault') device.health = 'ok';
    const changed = device.ingest(reading);
    if (changed) {
      this.opts.repos.devices.saveState(device.id, device.state);
      this.emit('device', device.snapshot());
    }

    if (NUMERIC_METRICS.has(reading.metric as NumericMetric)) {
      const point = { ts: new Date().toISOString(), value: reading.value as number };
      const metric = reading.metric as NumericMetric;
      const n = (this.readingCounter.get(deviceId) ?? 0) + 1;
      this.readingCounter.set(deviceId, n);
      if (n % (this.opts.readingPersistEvery ?? 1) === 0) this.opts.repos.readings.insert(deviceId, metric, point.ts, point.value);
      this.emit('telemetry', { deviceId, metric, point });
    }

    const discrete = reading.metric === 'contact_open' || reading.metric === 'motion';
    this.publish({
      type: 'device.reading',
      priority: discrete ? 'high' : 'low',
      source: 'device',
      deviceId,
      message: `${device.name}: ${reading.metric} = ${String(reading.value)}`,
      simulated,
      data: { reading },
    });
    // Discrete state changes are also user-visible events.
    if (discrete && changed) {
      const label = reading.metric === 'motion'
        ? (reading.value ? 'motion detected' : 'motion cleared')
        : (reading.value ? 'opened' : 'closed');
      this.publish({
        type: 'device.state', priority: reading.value ? 'high' : 'low', source: 'device', deviceId,
        message: `${device.name} ${label}`, simulated,
      });
    }
    return true;
  }

  heartbeat(deviceId: string): void {
    const d = this.devices.get(deviceId);
    if (d) this.touch(d);
  }

  /** Mark devices offline whose heartbeat is older than the timeout. Exposed for tests. */
  checkHeartbeats(now = Date.now()): string[] {
    const wentOffline: string[] = [];
    for (const d of this.devices.values()) {
      if (!d.online || !d.lastSeen) continue;
      if (now - Date.parse(d.lastSeen) > this.opts.heartbeatTimeoutMs) {
        d.online = false;
        wentOffline.push(d.id);
        this.emit('device', d.snapshot());
        this.publish({
          type: 'device.offline', priority: 'high', source: 'system', deviceId: d.id,
          message: `${d.name} missed heartbeat - marked offline`, simulated: d.origin === 'simulated',
        });
      }
    }
    return wentOffline;
  }

  private touch(d: Device) {
    d.lastSeen = new Date().toISOString();
    if (!d.online) {
      d.online = true;
      const reconnect = this.seen.has(d.id);
      this.seen.add(d.id);
      this.emit('device', d.snapshot());
      // First contact after boot is not a reconnection.
      if (reconnect) {
        this.publish({
          type: 'device.online', priority: 'normal', source: 'system', deviceId: d.id,
          message: `${d.name} is back online`, simulated: d.origin === 'simulated',
        });
        this.alerts.resolveFor('connectivity', d.id);
      }
    }
  }

  private sinkFor(adapter: DeviceAdapter): AdapterSink {
    return {
      reading: (id, raw, meta) => {
        const d = this.devices.get(id);
        if (d && d.adapterId !== adapter.id) {
          this.opts.repos.audit.log(`adapter:${adapter.id}`, `reading:${id}`, 'denied', 'device belongs to another adapter');
          return;
        }
        this.ingestReading(id, raw, meta.simulated);
      },
      heartbeat: (id) => {
        const d = this.devices.get(id);
        if (d && d.adapterId === adapter.id) this.heartbeat(id);
      },
      announce: (info, meta) => this.announce(adapter, info, meta.simulated),
      diagnostic: (message, level) => {
        if (level === 'warn') this.opts.repos.audit.log(`adapter:${adapter.id}`, 'diagnostic', 'denied', message);
        this.publish({
          type: 'system', priority: level === 'warn' ? 'high' : 'low', source: 'system', deviceId: null,
          message: `[${adapter.id}] ${message}`, simulated: adapter.origin === 'simulated',
        });
      },
    };
  }

  private announce(adapter: DeviceAdapter, info: { id: string; name: string; kind: DeviceKind; room: string }, simulated: boolean) {
    const existing = this.devices.get(info.id);
    if (existing) {
      if (existing.adapterId !== adapter.id) {
        this.opts.repos.audit.log(`adapter:${adapter.id}`, `announce:${info.id}`, 'denied', 'id already owned by another adapter');
      }
      return;
    }
    const initial = defaultState(info.kind);
    const d = createDevice(info.kind, { ...info, adapterId: adapter.id, origin: adapter.origin, state: initial as never });
    this.devices.set(d.id, d);
    this.opts.repos.devices.insert({ ...info, adapterId: adapter.id, origin: adapter.origin, state: initial });
    this.emit('device', d.snapshot());
    this.publish({
      type: 'system', priority: 'normal', source: 'system', deviceId: d.id,
      message: `Registered ${info.kind} "${info.name}" via ${adapter.id}${simulated ? ' (declared simulated)' : ''}`, simulated,
    });
  }

  private housekeeping() {
    this.opts.repos.events.prune(this.opts.maxStoredEvents ?? 20_000);
    this.opts.repos.readings.pruneOlderThan(new Date(Date.now() - 24 * 3600_000).toISOString());
  }
}

function defaultState(kind: DeviceKind): unknown {
  switch (kind) {
    case 'light': return { on: false, brightness: 100 };
    case 'thermostat': return { currentC: 20, targetC: 21, mode: 'off', heating: false, cooling: false };
    case 'smoke': return { obscuration: 0, alarm: false };
    case 'co': return { ppm: 0, alarm: false };
    case 'contact': return { open: false };
    case 'motion': return { motion: false, lastMotionAt: null };
    case 'security_panel': return { mode: 'disarmed', sirenActive: false };
  }
}

function describeCommand(c: DeviceCommand): string {
  switch (c.action) {
    case 'setPower': return c.on ? 'switched on' : 'switched off';
    case 'setBrightness': return `brightness ${c.level}%`;
    case 'setTarget': return `target ${c.celsius} °C`;
    case 'setMode': return `mode ${c.mode}`;
    case 'setSecurityMode': return `security ${c.mode.replace('_', ' ')}`;
    case 'silenceSiren': return 'siren silenced';
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 200);
  } catch {
    return '[unserialisable]';
  }
}
