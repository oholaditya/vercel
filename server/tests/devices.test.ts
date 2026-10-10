import { describe, expect, it } from 'vitest';
import {
  CommandError,
  CoSensor,
  LightDevice,
  SecurityPanel,
  SmokeSensor,
  ThermostatDevice,
} from '../src/devices/Device.js';
import { DeviceCommandSchema, SensorReadingSchema } from '../src/domain/schemas.js';

const base = { room: 'Test', adapterId: 'sim', origin: 'simulated' as const };

describe('LightDevice', () => {
  const light = () => new LightDevice({ ...base, id: 'l1', name: 'L1', state: { on: false, brightness: 50 } });

  it('turns on and off', () => {
    const l = light();
    l.commit(l.planCommand({ action: 'setPower', on: true }));
    expect(l.state).toEqual({ on: true, brightness: 50 });
    l.commit(l.planCommand({ action: 'setPower', on: false }));
    expect(l.state.on).toBe(false);
  });

  it('restores full brightness when switched on from 0%', () => {
    const l = new LightDevice({ ...base, id: 'l2', name: 'L2', state: { on: false, brightness: 0 } });
    expect(l.planCommand({ action: 'setPower', on: true })).toEqual({ on: true, brightness: 100 });
  });

  it('adjusts brightness and treats 0% as off', () => {
    const l = light();
    expect(l.planCommand({ action: 'setBrightness', level: 80 })).toEqual({ on: true, brightness: 80 });
    expect(l.planCommand({ action: 'setBrightness', level: 0 })).toEqual({ on: false, brightness: 0 });
  });

  it('rejects out-of-range brightness and unsupported commands', () => {
    const l = light();
    expect(() => l.planCommand({ action: 'setBrightness', level: 101 })).toThrow(CommandError);
    expect(() => l.planCommand({ action: 'setTarget', celsius: 21 })).toThrow(/not supported/);
  });

  it('planCommand does not mutate state', () => {
    const l = light();
    l.planCommand({ action: 'setPower', on: true });
    expect(l.state.on).toBe(false);
  });
});

describe('ThermostatDevice', () => {
  const t = () =>
    new ThermostatDevice({
      ...base, id: 't1', name: 'T1',
      state: { currentC: 20, targetC: 20, mode: 'auto', heating: false, cooling: false },
    });

  it('sets target temperature (rounded to 0.5 °C) and computes heating demand', () => {
    const th = t();
    const next = th.planCommand({ action: 'setTarget', celsius: 22.4 });
    expect(next.targetC).toBe(22.5);
    expect(next.heating).toBe(true);
    expect(next.cooling).toBe(false);
  });

  it('rejects targets outside 10..30 °C', () => {
    expect(() => t().planCommand({ action: 'setTarget', celsius: 35 })).toThrow(CommandError);
    expect(() => t().planCommand({ action: 'setTarget', celsius: 5 })).toThrow(CommandError);
  });

  it('has no demand when mode is off', () => {
    const th = t();
    th.commit(th.planCommand({ action: 'setMode', mode: 'off' }));
    th.ingest({ metric: 'temperature', value: 12 });
    expect(th.state.heating).toBe(false);
    expect(th.state.currentC).toBe(12);
  });

  it('cools when above target in auto mode', () => {
    const th = t();
    th.ingest({ metric: 'temperature', value: 24 });
    expect(th.state.cooling).toBe(true);
  });
});

describe('Safety sensors', () => {
  it('smoke sensor raises its local alarm at 10 %/m', () => {
    const s = new SmokeSensor({ ...base, id: 's1', name: 'S', state: { obscuration: 0, alarm: false } });
    s.ingest({ metric: 'obscuration', value: 9.9 });
    expect(s.state.alarm).toBe(false);
    s.ingest({ metric: 'obscuration', value: 12 });
    expect(s.state.alarm).toBe(true);
  });

  it('CO sensor raises its local alarm at 70 ppm', () => {
    const c = new CoSensor({ ...base, id: 'c1', name: 'C', state: { ppm: 0, alarm: false } });
    expect(c.ingest({ metric: 'co_ppm', value: 71 })).toBe(true);
    expect(c.state).toEqual({ ppm: 71, alarm: true });
  });

  it('ignores readings of an unrelated metric', () => {
    const c = new CoSensor({ ...base, id: 'c2', name: 'C', state: { ppm: 3, alarm: false } });
    expect(c.ingest({ metric: 'temperature', value: 50 })).toBe(false);
    expect(c.state.ppm).toBe(3);
  });

  it('marks low battery as degraded health', () => {
    const c = new CoSensor({ ...base, id: 'c3', name: 'C', state: { ppm: 3, alarm: false } });
    c.ingest({ metric: 'battery', value: 10 });
    expect(c.health).toBe('degraded');
  });
});

describe('SecurityPanel', () => {
  it('disarming silences the siren', () => {
    const p = new SecurityPanel({ ...base, id: 'p', name: 'P', state: { mode: 'armed_away', sirenActive: false } });
    expect(p.activateSiren()).toBe(true);
    expect(p.activateSiren()).toBe(false);
    p.commit(p.planCommand({ action: 'setSecurityMode', mode: 'disarmed' }));
    expect(p.state).toEqual({ mode: 'disarmed', sirenActive: false });
  });
});

describe('Input validation schemas', () => {
  it('rejects implausible sensor readings', () => {
    expect(SensorReadingSchema.safeParse({ metric: 'co_ppm', value: -5 }).success).toBe(false);
    expect(SensorReadingSchema.safeParse({ metric: 'temperature', value: 400 }).success).toBe(false);
    expect(SensorReadingSchema.safeParse({ metric: 'obscuration', value: Number.NaN }).success).toBe(false);
    expect(SensorReadingSchema.safeParse({ metric: 'contact_open', value: 'yes' }).success).toBe(false);
    expect(SensorReadingSchema.safeParse({ metric: 'co_ppm', value: 12 }).success).toBe(true);
  });

  it('rejects malformed commands and unknown fields', () => {
    expect(DeviceCommandSchema.safeParse({ action: 'setBrightness', level: 50.5 }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ action: 'setPower', on: true, extra: 1 }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ action: 'selfDestruct' }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ action: 'setTarget', celsius: 21.5 }).success).toBe(true);
  });
});
