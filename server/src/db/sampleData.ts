import type { AutomationRule, DeviceKind, DeviceStateMap } from '../domain/types.js';
import type { DeviceRecord } from './repositories.js';

/**
 * Sample devices and default rules. Dependency-free so it can also be bundled
 * into the browser-only demo build (client/src/backend/demo.ts).
 */

export type SeedDevice<K extends DeviceKind = DeviceKind> = Omit<DeviceRecord, 'adapterId' | 'origin' | 'state'> & {
  kind: K;
  state: DeviceStateMap[K];
};

/** Sample SIMULATED devices. All are attached to the simulator adapter ("sim"). */
export const SAMPLE_DEVICES: SeedDevice[] = [
  { id: 'light-living', name: 'Living Room Ceiling', kind: 'light', room: 'Living Room', state: { on: true, brightness: 70 } },
  { id: 'light-kitchen', name: 'Kitchen Pendants', kind: 'light', room: 'Kitchen', state: { on: false, brightness: 100 } },
  { id: 'light-hall', name: 'Hallway Light', kind: 'light', room: 'Hallway', state: { on: false, brightness: 60 } },
  { id: 'light-entrance', name: 'Porch Light', kind: 'light', room: 'Entrance', state: { on: false, brightness: 100 } },
  { id: 'light-bedroom', name: 'Bedroom Lamp', kind: 'light', room: 'Bedroom', state: { on: false, brightness: 40 } },
  {
    id: 'thermo-main', name: 'Main Thermostat', kind: 'thermostat', room: 'Living Room',
    state: { currentC: 20.4, targetC: 21.5, mode: 'auto', heating: false, cooling: false },
  },
  {
    id: 'thermo-bedroom', name: 'Bedroom Thermostat', kind: 'thermostat', room: 'Bedroom',
    state: { currentC: 19.2, targetC: 19, mode: 'heat', heating: false, cooling: false },
  },
  { id: 'smoke-kitchen', name: 'Kitchen Smoke Sensor', kind: 'smoke', room: 'Kitchen', state: { obscuration: 0.4, alarm: false } },
  { id: 'smoke-hall', name: 'Hallway Smoke Sensor', kind: 'smoke', room: 'Hallway', state: { obscuration: 0.4, alarm: false } },
  { id: 'co-utility', name: 'Utility Room CO Sensor', kind: 'co', room: 'Utility', state: { ppm: 3, alarm: false } },
  { id: 'co-bedroom', name: 'Bedroom CO Sensor', kind: 'co', room: 'Bedroom', state: { ppm: 2, alarm: false } },
  { id: 'contact-front', name: 'Front Door', kind: 'contact', room: 'Entrance', state: { open: false } },
  { id: 'contact-patio', name: 'Patio Door', kind: 'contact', room: 'Living Room', state: { open: false } },
  { id: 'contact-bedroom-window', name: 'Bedroom Window', kind: 'contact', room: 'Bedroom', state: { open: false } },
  { id: 'motion-hall', name: 'Hallway Motion', kind: 'motion', room: 'Hallway', state: { motion: false, lastMotionAt: null } },
  { id: 'motion-entrance', name: 'Entrance Motion', kind: 'motion', room: 'Entrance', state: { motion: false, lastMotionAt: null } },
  { id: 'panel-main', name: 'Security Panel', kind: 'security_panel', room: 'Entrance', state: { mode: 'armed_home', sirenActive: false } },
];

export type SeedRule = Omit<AutomationRule, 'id' | 'lastFiredAt' | 'createdAt'>;

export const DEFAULT_RULES: SeedRule[] = [
  {
    name: 'Motion → room lights',
    description: 'When any motion sensor detects movement, switch on the lights in the same room.',
    enabled: true,
    trigger: { type: 'motion' },
    actions: [{ type: 'lights', on: true, brightness: 80 }],
    cooldownMs: 60_000,
  },
  {
    name: 'Intrusion while armed',
    description: 'A door or window opens while the system is armed: raise a critical alert and sound the siren.',
    enabled: true,
    trigger: { type: 'intrusion', requireArmed: true },
    actions: [
      { type: 'raise_alert', severity: 'critical', category: 'intrusion', title: 'Intrusion detected' },
      { type: 'activate_siren' },
    ],
    cooldownMs: 10_000,
  },
  {
    name: 'Smoke threshold',
    description: 'Smoke obscuration above 10 %/m: raise a critical alert and switch on every light for egress.',
    enabled: true,
    trigger: { type: 'threshold', metric: 'obscuration', op: '>', value: 10 },
    actions: [
      { type: 'raise_alert', severity: 'critical', category: 'smoke', title: 'Smoke detected' },
      { type: 'lights', on: true, room: '*', brightness: 100 },
    ],
    cooldownMs: 0,
  },
  {
    name: 'CO warning',
    description: 'Carbon monoxide above 35 ppm: raise a high-priority warning.',
    enabled: true,
    trigger: { type: 'threshold', metric: 'co_ppm', op: '>', value: 35 },
    actions: [{ type: 'raise_alert', severity: 'warning', category: 'co', title: 'Elevated carbon monoxide' }],
    cooldownMs: 0,
  },
  {
    name: 'CO critical',
    description: 'Carbon monoxide above 70 ppm: escalate to a critical alert.',
    enabled: true,
    trigger: { type: 'threshold', metric: 'co_ppm', op: '>', value: 70 },
    actions: [{ type: 'raise_alert', severity: 'critical', category: 'co', title: 'Dangerous carbon monoxide level' }],
    cooldownMs: 0,
  },
  {
    name: 'High indoor temperature',
    description: 'Room temperature above 28 °C: raise a warning.',
    enabled: true,
    trigger: { type: 'threshold', metric: 'temperature', op: '>', value: 28 },
    actions: [{ type: 'raise_alert', severity: 'warning', category: 'threshold', title: 'High indoor temperature' }],
    cooldownMs: 0,
  },
  {
    name: 'Device connectivity watchdog',
    description: 'A device misses its heartbeat window: raise a connectivity warning.',
    enabled: true,
    trigger: { type: 'device_offline' },
    actions: [{ type: 'raise_alert', severity: 'warning', category: 'connectivity', title: 'Device offline' }],
    cooldownMs: 0,
  },
];
