import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubServer } from '../src/app.js';
import { AlertError } from '../src/engine/AlertManager.js';
import { createTestHub } from './helpers.js';

let h: HubServer;
beforeEach(async () => {
  h = await createTestHub();
});
afterEach(async () => {
  await h.close();
});

const input = {
  severity: 'warning' as const,
  category: 'threshold' as const,
  title: 'Test alert',
  message: 'Something happened',
  deviceId: 'co-utility',
  ruleId: null,
  simulated: true,
};

describe('AlertManager', () => {
  it('creates an active alert and emits a high-priority event', async () => {
    const { alert, created } = h.hub.alerts.raise(input);
    expect(created).toBe(true);
    expect(alert.status).toBe('active');
    await h.hub.engine.idle();
    const ev = h.repos.events.query({ type: 'alert.raised' })[0];
    expect(ev).toMatchObject({ priority: 'high', simulated: true });
  });

  it('critical alerts produce critical-priority events', async () => {
    h.hub.alerts.raise({ ...input, severity: 'critical', category: 'smoke' });
    await h.hub.engine.idle();
    expect(h.repos.events.query({ type: 'alert.raised' })[0]?.priority).toBe('critical');
  });

  it('de-duplicates open alerts per category + device', () => {
    const a = h.hub.alerts.raise(input);
    const b = h.hub.alerts.raise(input);
    expect(b.created).toBe(false);
    expect(b.alert.id).toBe(a.alert.id);
    // A different device gets its own alert.
    expect(h.hub.alerts.raise({ ...input, deviceId: 'co-bedroom' }).created).toBe(true);
  });

  it('acknowledge → resolve lifecycle with attribution', () => {
    const { alert } = h.hub.alerts.raise(input);
    const acked = h.hub.alerts.acknowledge(alert.id, 'operator');
    expect(acked).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'operator' });
    expect(acked.acknowledgedAt).not.toBeNull();
    const resolved = h.hub.alerts.resolve(alert.id, 'operator');
    expect(resolved.status).toBe('resolved');
    expect(h.hub.alerts.openCounts().total).toBe(0);
  });

  it('rejects invalid transitions', () => {
    const { alert } = h.hub.alerts.raise(input);
    h.hub.alerts.acknowledge(alert.id, 'u');
    expect(() => h.hub.alerts.acknowledge(alert.id, 'u')).toThrow(AlertError);
    h.hub.alerts.resolve(alert.id, 'u');
    expect(() => h.hub.alerts.resolve(alert.id, 'u')).toThrow(/already resolved/);
    expect(() => h.hub.alerts.acknowledge('00000000-0000-4000-8000-000000000000', 'u')).toThrow(/not found/);
  });

  it('after resolution a new occurrence opens a fresh alert', () => {
    const first = h.hub.alerts.raise(input).alert;
    h.hub.alerts.resolve(first.id, 'u');
    const second = h.hub.alerts.raise(input);
    expect(second.created).toBe(true);
    expect(second.alert.id).not.toBe(first.id);
  });

  it('system status reflects open alerts', () => {
    // Devices start online after the simulator's first heartbeat.
    expect(h.hub.overview().status).toBe('nominal');
    h.hub.alerts.raise(input);
    expect(h.hub.overview().status).toBe('degraded');
    h.hub.alerts.raise({ ...input, severity: 'critical', category: 'smoke' });
    expect(h.hub.overview()).toMatchObject({ status: 'critical', criticalAlerts: 1, activeAlerts: 2 });
  });
});
