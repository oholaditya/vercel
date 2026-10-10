import type { DataOrigin, DeviceCommand, DeviceKind, DeviceSnapshot } from '../../domain/types.js';

/**
 * Communication-layer boundary. Every transport (simulator, QNX bridge, and in the
 * future Zigbee / Thread / Matter gateways) implements this interface and pushes
 * UNTRUSTED raw data into the hub through an AdapterSink. The hub validates
 * everything that arrives here before it touches device state.
 */
export interface AdapterSink {
  /** Raw reading - validated by the hub (unknown shape on purpose). */
  reading(deviceId: string, reading: unknown, meta: { simulated: boolean }): void;
  /** Liveness signal; absence beyond HEARTBEAT_TIMEOUT_MS marks a device offline. */
  heartbeat(deviceId: string): void;
  /** Adapter-reported device announcement (bridge only). */
  announce?(device: { id: string; name: string; kind: DeviceKind; room: string }, meta: { simulated: boolean }): void;
  /** Adapter-level diagnostic (e.g. rejected frame). */
  diagnostic(message: string, level: 'info' | 'warn'): void;
}

export interface DeviceAdapter {
  readonly id: string;
  readonly origin: DataOrigin;
  start(sink: AdapterSink): Promise<void>;
  stop(): Promise<void>;
  /** Transmit a validated command. Rejects if the device cannot be reached. */
  sendCommand(device: DeviceSnapshot, command: DeviceCommand): Promise<void>;
  status(): { connected: boolean; detail: string };
}

export class DeviceUnreachableError extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is not reachable`);
    this.name = 'DeviceUnreachableError';
  }
}
