/**
 * Domain contract shared by the server and the client.
 *
 * This file must contain TYPES ONLY (no runtime imports) because the client
 * imports it with `import type` across the workspace boundary.
 */

// ---------------------------------------------------------------- devices

export type DeviceKind =
  | 'light'
  | 'thermostat'
  | 'smoke'
  | 'co'
  | 'contact'
  | 'motion'
  | 'security_panel';

export type DeviceHealth = 'ok' | 'degraded' | 'fault';

/** Where a device's data comes from. Only `simulated` exists in this prototype. */
export type DataOrigin = 'simulated' | 'bridge';

export interface LightState {
  on: boolean;
  brightness: number; // 0..100 %
}

export type ThermostatMode = 'off' | 'heat' | 'cool' | 'auto';
export interface ThermostatState {
  currentC: number;
  targetC: number;
  mode: ThermostatMode;
  heating: boolean;
  cooling: boolean;
}

export interface SmokeState {
  /** Obscuration in %/m. Simulated value - not a certified measurement. */
  obscuration: number;
  alarm: boolean;
}

export interface CoState {
  ppm: number;
  alarm: boolean;
}

export interface ContactState {
  open: boolean;
}

export interface MotionState {
  motion: boolean;
  lastMotionAt: string | null;
}

export type SecurityMode = 'disarmed' | 'armed_home' | 'armed_away';
export interface SecurityPanelState {
  mode: SecurityMode;
  sirenActive: boolean;
}

export interface DeviceStateMap {
  light: LightState;
  thermostat: ThermostatState;
  smoke: SmokeState;
  co: CoState;
  contact: ContactState;
  motion: MotionState;
  security_panel: SecurityPanelState;
}

export interface DeviceSnapshot<K extends DeviceKind = DeviceKind> {
  id: string;
  name: string;
  kind: K;
  room: string;
  origin: DataOrigin;
  adapterId: string;
  online: boolean;
  health: DeviceHealth;
  battery: number | null;
  lastSeen: string | null;
  state: DeviceStateMap[K];
}

// ---------------------------------------------------------------- commands

export type DeviceCommand =
  | { action: 'setPower'; on: boolean }
  | { action: 'setBrightness'; level: number }
  | { action: 'setTarget'; celsius: number }
  | { action: 'setMode'; mode: ThermostatMode }
  | { action: 'setSecurityMode'; mode: SecurityMode }
  | { action: 'silenceSiren' };

/** Readings arriving from an adapter (simulated or bridge). */
export type SensorReading =
  | { metric: 'temperature'; value: number }
  | { metric: 'obscuration'; value: number }
  | { metric: 'co_ppm'; value: number }
  | { metric: 'contact_open'; value: boolean }
  | { metric: 'motion'; value: boolean }
  | { metric: 'battery'; value: number };

export type NumericMetric = 'temperature' | 'obscuration' | 'co_ppm';

// ---------------------------------------------------------------- events

export type EventPriority = 'critical' | 'high' | 'normal' | 'low';

export type EventType =
  | 'device.reading'
  | 'device.state'
  | 'device.offline'
  | 'device.online'
  | 'device.command'
  | 'device.command_failed'
  | 'automation.fired'
  | 'alert.raised'
  | 'alert.acknowledged'
  | 'alert.resolved'
  | 'security.mode'
  | 'security.auth'
  | 'system';

export type EventSource = 'device' | 'user' | 'automation' | 'system' | 'security';

export interface HubEvent {
  id: string;
  ts: string;
  type: EventType;
  priority: EventPriority;
  source: EventSource;
  deviceId: string | null;
  message: string;
  /** true when the event originates from the simulator (never real sensor data). */
  simulated: boolean;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------- alerts

export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';
export type AlertCategory = 'smoke' | 'co' | 'intrusion' | 'connectivity' | 'threshold' | 'system';

export interface Alert {
  id: string;
  ts: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  deviceId: string | null;
  ruleId: string | null;
  status: AlertStatus;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  simulated: boolean;
}

// ---------------------------------------------------------------- automation

export type RuleTrigger =
  | { type: 'motion'; deviceId?: string }
  | { type: 'intrusion'; deviceId?: string; requireArmed: boolean }
  | {
      type: 'threshold';
      metric: NumericMetric;
      op: '>' | '<';
      value: number;
      deviceId?: string;
    }
  | { type: 'device_offline'; deviceId?: string };

export type RuleAction =
  | { type: 'device_command'; deviceId: string; command: DeviceCommand }
  | { type: 'lights'; on: boolean; room?: string; brightness?: number }
  | {
      type: 'raise_alert';
      severity: AlertSeverity;
      category: AlertCategory;
      title: string;
      message?: string;
    }
  | { type: 'activate_siren' };

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: RuleTrigger;
  actions: RuleAction[];
  cooldownMs: number;
  lastFiredAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- users

export type Role = 'admin' | 'operator' | 'viewer';

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}

// ---------------------------------------------------------------- system

export interface EngineStats {
  queueDepth: number;
  processed: number;
  dropped: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  byPriority: Record<EventPriority, number>;
}

export type SystemStatus = 'nominal' | 'degraded' | 'critical';

export interface SystemOverview {
  status: SystemStatus;
  uptimeSec: number;
  devicesTotal: number;
  devicesOnline: number;
  activeAlerts: number;
  criticalAlerts: number;
  rulesEnabled: number;
  simulationRunning: boolean;
  engine: EngineStats;
  version: string;
}

export interface TelemetryPoint {
  ts: string;
  value: number;
}

export interface ActivityBucket {
  ts: string;
  count: number;
}

export type SimulationScenario =
  | 'smoke'
  | 'co'
  | 'intrusion'
  | 'motion'
  | 'disconnect'
  | 'reconnect'
  | 'clear';

/** Socket.IO server -> client events. */
export interface ServerToClientEvents {
  'device:update': (device: DeviceSnapshot) => void;
  'event:new': (event: HubEvent) => void;
  'alert:upsert': (alert: Alert) => void;
  'rule:upsert': (rule: AutomationRule) => void;
  'rule:delete': (id: string) => void;
  'system:overview': (overview: SystemOverview) => void;
  'telemetry:point': (p: { deviceId: string; metric: NumericMetric; point: TelemetryPoint }) => void;
}
