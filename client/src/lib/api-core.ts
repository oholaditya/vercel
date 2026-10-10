import type {
  ActivityBucket,
  Alert,
  AutomationRule,
  DeviceCommand,
  DeviceSnapshot,
  EventPriority,
  HubEvent,
  NumericMetric,
  PublicUser,
  ServerToClientEvents,
  SimulationScenario,
  SystemOverview,
  TelemetryPoint,
} from '@shared/types';

/**
 * Backend contract shared by the HTTP backend (real server) and the
 * in-browser demo backend. `@backend` resolves to one of them at build time.
 */

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: Array<{ path: string; message: string }>) {
    super(message);
  }
}

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  outcome: 'success' | 'denied' | 'failed';
  ip: string | null;
  detail: string | null;
}

export interface AdapterStatus {
  id: string;
  origin: string;
  connected: boolean;
  detail: string;
}

export interface EventQuery {
  limit?: number;
  priority?: EventPriority;
  before?: string;
  deviceId?: string;
}

export interface HubApi {
  login(username: string, password: string): Promise<{ token: string; user: PublicUser }>;
  me(): Promise<{ user: PublicUser }>;
  devices(): Promise<{ devices: DeviceSnapshot[] }>;
  command(id: string, command: DeviceCommand): Promise<{ device: DeviceSnapshot }>;
  history(id: string, limit?: number): Promise<{ metric: NumericMetric; points: TelemetryPoint[] }>;
  rules(): Promise<{ rules: AutomationRule[] }>;
  createRule(rule: unknown): Promise<{ rule: AutomationRule }>;
  updateRule(id: string, patch: Partial<AutomationRule>): Promise<{ rule: AutomationRule }>;
  deleteRule(id: string): Promise<void>;
  alerts(status?: Alert['status'] | 'open', limit?: number): Promise<{ alerts: Alert[] }>;
  acknowledge(id: string): Promise<{ alert: Alert }>;
  resolve(id: string): Promise<{ alert: Alert }>;
  events(q?: EventQuery): Promise<{ events: HubEvent[] }>;
  overview(): Promise<{ overview: SystemOverview; adapters: AdapterStatus[] }>;
  activity(minutes?: number): Promise<{ buckets: ActivityBucket[] }>;
  audit(limit?: number): Promise<{ entries: AuditEntry[] }>;
  scenario(scenario: SimulationScenario, deviceId?: string): Promise<{ simulated: true; description: string }>;
  setSimulation(running: boolean): Promise<{ running: boolean }>;
}

/** Minimal real-time channel used by the hub store (Socket.IO or in-page emitter). */
export interface HubSocket {
  on<E extends keyof ServerToClientEvents>(event: E, listener: ServerToClientEvents[E]): void;
  on(event: 'connect' | 'disconnect' | 'connect_error', listener: () => void): void;
  close(): void;
}

// ------------------------------------------------------------- session token

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function getToken() {
  return token;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}
export function notifyUnauthorized() {
  onUnauthorized?.();
}
