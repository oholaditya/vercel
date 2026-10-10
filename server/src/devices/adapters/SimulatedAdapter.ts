import type { DeviceCommand, DeviceSnapshot, SimulationScenario } from '../../domain/types.js';
import { DeviceUnreachableError, type AdapterSink, type DeviceAdapter } from './DeviceAdapter.js';

interface SimDevice {
  id: string;
  kind: DeviceSnapshot['kind'];
  room: string;
  value: number; // temperature / obscuration / ppm
  target: number; // value the physics model drifts toward
  open: boolean;
  motionUntil: number;
  battery: number;
  thermostat?: { targetC: number; mode: string };
}

const AMBIENT_C = 19.5;
const SMOKE_BASELINE = 0.4;
const CO_BASELINE = 3;

export interface SimulatedAdapterOptions {
  tickMs: number;
  /** When false the adapter never schedules its own timer (tests drive `tick()` manually). */
  autoTick: boolean;
  /** Probability per motion sensor per minute of spontaneous motion. */
  motionPerMinute?: number;
  random?: () => number;
}

/**
 * SIMULATED transport. Generates plausible sensor data with a tiny physics model.
 * Every reading it emits is tagged `simulated: true` and must never be presented
 * as real safety monitoring.
 */
export class SimulatedAdapter implements DeviceAdapter {
  readonly id = 'sim';
  readonly origin = 'simulated' as const;
  private sink: AdapterSink | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly sims = new Map<string, SimDevice>();
  private readonly disconnected = new Set<string>();
  private running = false;
  private tickCount = 0;
  private readonly rnd: () => number;

  constructor(private readonly opts: SimulatedAdapterOptions) {
    this.rnd = opts.random ?? Math.random;
  }

  register(devices: DeviceSnapshot[]): void {
    for (const d of devices) {
      if (d.adapterId !== this.id) continue;
      const s: SimDevice = {
        id: d.id, kind: d.kind, room: d.room, value: 0, target: 0, open: false, motionUntil: 0,
        battery: d.battery ?? 100,
      };
      if (d.kind === 'thermostat') {
        const st = d.state as { currentC: number; targetC: number; mode: string };
        s.value = st.currentC; s.target = AMBIENT_C; s.thermostat = { targetC: st.targetC, mode: st.mode };
      } else if (d.kind === 'smoke') { s.value = SMOKE_BASELINE; s.target = SMOKE_BASELINE; }
      else if (d.kind === 'co') { s.value = CO_BASELINE; s.target = CO_BASELINE; }
      else if (d.kind === 'contact') { s.open = (d.state as { open: boolean }).open; }
      this.sims.set(d.id, s);
    }
  }

  async start(sink: AdapterSink): Promise<void> {
    this.sink = sink;
    this.running = true;
    if (this.opts.autoTick && !this.timer) {
      this.timer = setInterval(() => this.tick(this.opts.tickMs), this.opts.tickMs);
      this.timer.unref?.();
    }
    // Announce liveness immediately so devices appear online at boot.
    for (const s of this.sims.values()) sink.heartbeat(s.id);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  setRunning(on: boolean): void {
    if (!this.sink) return;
    if (on && !this.running) void this.start(this.sink);
    if (!on && this.running) void this.stop();
  }

  status() {
    return { connected: this.running, detail: `${this.sims.size} simulated devices, ${this.disconnected.size} disconnected` };
  }

  async sendCommand(device: DeviceSnapshot, command: DeviceCommand): Promise<void> {
    if (this.disconnected.has(device.id)) throw new DeviceUnreachableError(device.id);
    const s = this.sims.get(device.id);
    if (s?.thermostat) {
      if (command.action === 'setTarget') s.thermostat.targetC = command.celsius;
      if (command.action === 'setMode') s.thermostat.mode = command.mode;
      if (command.action === 'setPower') s.thermostat.mode = command.on ? 'auto' : 'off';
    }
  }

  isDisconnected(deviceId: string): boolean {
    return this.disconnected.has(deviceId);
  }

  /** Advance the physics model by `dtMs` and emit readings + heartbeats. */
  tick(dtMs = this.opts.tickMs): void {
    const sink = this.sink;
    if (!sink) return;
    this.tickCount++;
    const now = Date.now();
    const dtMin = dtMs / 60_000;
    const motionP = (this.opts.motionPerMinute ?? 1.2) * dtMin;

    for (const s of this.sims.values()) {
      if (this.disconnected.has(s.id)) continue;
      sink.heartbeat(s.id);
      const noise = (amp: number) => (this.rnd() - 0.5) * 2 * amp;

      switch (s.kind) {
        case 'thermostat': {
          const t = s.thermostat!;
          const heat = (t.mode === 'heat' || t.mode === 'auto') && s.value < t.targetC - 0.3;
          const cool = (t.mode === 'cool' || t.mode === 'auto') && s.value > t.targetC + 0.3;
          const rate = 0.6 * dtMin * 10; // °C per tick-ish, scaled to be visible in a demo
          if (heat) s.value += rate;
          else if (cool) s.value -= rate;
          else s.value += (AMBIENT_C - s.value) * 0.02 + noise(0.04);
          sink.reading(s.id, { metric: 'temperature', value: round(s.value, 2) }, { simulated: true });
          break;
        }
        case 'smoke':
        case 'co': {
          s.value += (s.target - s.value) * 0.35 + noise(s.kind === 'smoke' ? 0.08 : 0.6);
          s.value = Math.max(0, s.value);
          sink.reading(s.id, { metric: s.kind === 'smoke' ? 'obscuration' : 'co_ppm', value: round(s.value, 2) }, { simulated: true });
          break;
        }
        case 'motion': {
          if (s.motionUntil === 0 && this.rnd() < motionP) this.triggerMotion(s, now);
          else if (s.motionUntil > 0 && now >= s.motionUntil) {
            s.motionUntil = 0;
            sink.reading(s.id, { metric: 'motion', value: false }, { simulated: true });
          }
          break;
        }
        default:
          break;
      }

      // Battery reports every ~30 ticks for battery-powered sensors.
      if (s.kind !== 'light' && s.kind !== 'security_panel' && s.kind !== 'thermostat' && this.tickCount % 30 === 0) {
        s.battery = Math.max(0, s.battery - 0.05);
        sink.reading(s.id, { metric: 'battery', value: round(s.battery, 1) }, { simulated: true });
      }
    }
  }

  private triggerMotion(s: SimDevice, now: number) {
    s.motionUntil = now + 8_000;
    this.sink?.reading(s.id, { metric: 'motion', value: true }, { simulated: true });
  }

  private pick(kind: SimDevice['kind'], deviceId?: string): SimDevice | undefined {
    if (deviceId) {
      const s = this.sims.get(deviceId);
      return s && (kind === s.kind || kind === 'light') ? s : undefined;
    }
    return [...this.sims.values()].find((s) => s.kind === kind);
  }

  /** Inject a named, clearly-simulated scenario. Returns a human readable description. */
  runScenario(scenario: SimulationScenario, deviceId?: string): string {
    const sink = this.sink;
    if (!sink) throw new Error('Simulator not started');
    switch (scenario) {
      case 'smoke': {
        const s = this.pick('smoke', deviceId);
        if (!s) throw new Error('No simulated smoke sensor found');
        s.target = 24;
        s.value = Math.max(s.value, 6);
        sink.reading(s.id, { metric: 'obscuration', value: round(s.value, 2) }, { simulated: true });
        return `Simulated smoke build-up at ${s.id}`;
      }
      case 'co': {
        const s = this.pick('co', deviceId);
        if (!s) throw new Error('No simulated CO sensor found');
        s.target = 140;
        s.value = Math.max(s.value, 45);
        sink.reading(s.id, { metric: 'co_ppm', value: round(s.value, 2) }, { simulated: true });
        return `Simulated CO rise at ${s.id}`;
      }
      case 'intrusion': {
        const s = this.pick('contact', deviceId);
        if (!s) throw new Error('No simulated contact sensor found');
        s.open = true;
        sink.reading(s.id, { metric: 'contact_open', value: true }, { simulated: true });
        return `Simulated door/window opening at ${s.id}`;
      }
      case 'motion': {
        const s = this.pick('motion', deviceId);
        if (!s) throw new Error('No simulated motion sensor found');
        this.triggerMotion(s, Date.now());
        return `Simulated motion at ${s.id}`;
      }
      case 'disconnect': {
        const s = deviceId ? this.sims.get(deviceId) : this.pick('co');
        if (!s) throw new Error('Device not found in simulator');
        this.disconnected.add(s.id);
        return `Simulated link loss for ${s.id} (goes offline after heartbeat timeout)`;
      }
      case 'reconnect': {
        const ids = deviceId ? [deviceId] : [...this.disconnected];
        for (const id of ids) {
          this.disconnected.delete(id);
          sink.heartbeat(id);
        }
        return `Simulated reconnection of ${ids.length} device(s)`;
      }
      case 'clear': {
        for (const s of this.sims.values()) {
          if (s.kind === 'smoke') s.target = SMOKE_BASELINE;
          if (s.kind === 'co') s.target = CO_BASELINE;
          if (s.kind === 'contact' && s.open) {
            s.open = false;
            sink.reading(s.id, { metric: 'contact_open', value: false }, { simulated: true });
          }
        }
        return 'Simulated conditions returning to baseline';
      }
    }
  }
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
