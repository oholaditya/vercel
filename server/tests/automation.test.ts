import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubServer } from '../src/app.js';
import { createTestHub, feed } from './helpers.js';

let h: HubServer;

beforeEach(async () => {
  h = await createTestHub();
});
afterEach(async () => {
  await h.close();
});

const openAlerts = () => h.hub.alerts.list('open');
const ruleByName = (name: string) => h.hub.automation.list().find((r) => r.name === name)!;

describe('Automation rules', () => {
  it('motion detected → lights in the same room switch on', async () => {
    expect(h.hub.getDevice('light-hall')!.state).toMatchObject({ on: false });
    await feed(h, 'motion-hall', { metric: 'motion', value: true });
    expect(h.hub.getDevice('light-hall')!.state).toEqual({ on: true, brightness: 80 });
    // Lights in other rooms are untouched.
    expect(h.hub.getDevice('light-kitchen')!.state).toMatchObject({ on: false });
    const fired = h.repos.events.query({ type: 'automation.fired' });
    expect(fired[0]?.message).toContain('Motion → room lights');
    expect(fired[0]?.simulated).toBe(true);
  });

  it('respects the rule cooldown', async () => {
    await feed(h, 'motion-hall', { metric: 'motion', value: true });
    await h.hub.executeCommand('light-hall', { action: 'setPower', on: false }, 'tester');
    await feed(h, 'motion-hall', { metric: 'motion', value: false });
    await feed(h, 'motion-hall', { metric: 'motion', value: true });
    expect(h.hub.getDevice('light-hall')!.state).toMatchObject({ on: false });
  });

  it('intrusion while armed → critical alert and siren', async () => {
    expect(h.hub.securityMode()).toBe('armed_home');
    await feed(h, 'contact-front', { metric: 'contact_open', value: true });
    const alerts = openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ category: 'intrusion', severity: 'critical', deviceId: 'contact-front', simulated: true });
    expect(h.hub.getDevice('panel-main')!.state).toMatchObject({ sirenActive: true });
  });

  it('intrusion while disarmed does not alert', async () => {
    await h.hub.executeCommand('panel-main', { action: 'setSecurityMode', mode: 'disarmed' }, 'tester');
    await feed(h, 'contact-front', { metric: 'contact_open', value: true });
    expect(openAlerts()).toHaveLength(0);
    expect(h.hub.getDevice('panel-main')!.state).toMatchObject({ sirenActive: false });
  });

  it('CO threshold → warning, then escalates the same alert to critical', async () => {
    await feed(h, 'co-utility', { metric: 'co_ppm', value: 40 });
    let alerts = openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ category: 'co', severity: 'warning' });

    await feed(h, 'co-utility', { metric: 'co_ppm', value: 90 });
    alerts = openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: 'critical', title: 'Dangerous carbon monoxide level' });
  });

  it('threshold rules are edge-triggered (no repeat while still above)', async () => {
    await feed(h, 'smoke-kitchen', { metric: 'obscuration', value: 15 });
    const id = openAlerts()[0]!.id;
    h.hub.alerts.resolve(id, 'tester');
    await feed(h, 'smoke-kitchen', { metric: 'obscuration', value: 16 });
    expect(openAlerts()).toHaveLength(0);
    // Drop below and cross again → re-arms.
    await feed(h, 'smoke-kitchen', { metric: 'obscuration', value: 1 });
    await feed(h, 'smoke-kitchen', { metric: 'obscuration', value: 14 });
    expect(openAlerts()).toHaveLength(1);
  });

  it('smoke switches on every light for egress', async () => {
    await feed(h, 'smoke-hall', { metric: 'obscuration', value: 20 });
    const lights = h.hub.listDevices().filter((d) => d.kind === 'light');
    expect(lights.every((l) => (l.state as { on: boolean }).on)).toBe(true);
  });

  it('device disconnected → connectivity warning; reconnect auto-resolves it', async () => {
    h.simulator!.runScenario('disconnect', 'co-bedroom');
    const offline = h.hub.checkHeartbeats(Date.now() + 10_000);
    expect(offline).toContain('co-bedroom');
    await h.hub.engine.idle();
    expect(h.hub.getDevice('co-bedroom')!.online).toBe(false);
    // Other devices also went stale because the test clock jumped; only check ours.
    const alert = openAlerts().find((a) => a.deviceId === 'co-bedroom');
    expect(alert).toMatchObject({ category: 'connectivity', severity: 'warning' });

    h.simulator!.runScenario('reconnect', 'co-bedroom');
    await h.hub.engine.idle();
    expect(h.hub.getDevice('co-bedroom')!.online).toBe(true);
    expect(openAlerts().find((a) => a.deviceId === 'co-bedroom')).toBeUndefined();
  });

  it('commands to an offline device fail and are logged', async () => {
    h.simulator!.runScenario('disconnect', 'light-kitchen');
    await expect(h.hub.executeCommand('light-kitchen', { action: 'setPower', on: true }, 'tester')).rejects.toThrow(
      /not reachable/,
    );
    await h.hub.engine.idle();
    expect(h.repos.events.query({ type: 'device.command_failed' })).toHaveLength(1);
    expect(h.repos.audit.list()[0]).toMatchObject({ outcome: 'failed', actor: 'tester' });
  });

  it('disabled rules do not fire', async () => {
    h.hub.automation.update(ruleByName('Motion → room lights').id, { enabled: false });
    await feed(h, 'motion-hall', { metric: 'motion', value: true });
    expect(h.hub.getDevice('light-hall')!.state).toMatchObject({ on: false });
  });

  it('supports user-defined rules with explicit device commands', async () => {
    h.hub.automation.create({
      name: 'Patio opens → thermostat off',
      description: '',
      enabled: true,
      trigger: { type: 'intrusion', deviceId: 'contact-patio', requireArmed: false },
      actions: [{ type: 'device_command', deviceId: 'thermo-main', command: { action: 'setMode', mode: 'off' } }],
      cooldownMs: 0,
    });
    await feed(h, 'contact-patio', { metric: 'contact_open', value: true });
    expect(h.hub.getDevice('thermo-main')!.state).toMatchObject({ mode: 'off' });
  });

  it('rejects rules that reference unknown devices', () => {
    expect(() =>
      h.hub.automation.create({
        name: 'bad', description: '', enabled: true, cooldownMs: 0,
        trigger: { type: 'motion', deviceId: 'nope' },
        actions: [{ type: 'activate_siren' }],
      }),
    ).toThrow(/Unknown device/);
  });

  it('rejects invalid readings, marks the device faulty and does not trigger rules', async () => {
    await feed(h, 'co-utility', { metric: 'co_ppm', value: 99999 });
    expect(h.hub.getDevice('co-utility')!.health).toBe('fault');
    expect(openAlerts()).toHaveLength(0);
    expect(h.repos.audit.list()[0]).toMatchObject({ outcome: 'denied' });
  });
});
