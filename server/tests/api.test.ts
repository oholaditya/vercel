import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubServer } from '../src/app.js';
import { createTestHub, login } from './helpers.js';

let h: HubServer;
let admin: string;
let operator: string;
let viewer: string;

beforeAll(async () => {
  h = await createTestHub();
  [admin, operator, viewer] = await Promise.all([login(h, 'admin'), login(h, 'operator'), login(h, 'viewer')]);
});
afterAll(async () => {
  await h.close();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Authentication & access control', () => {
  it('health is public', async () => {
    const res = await request(h.app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rejects requests without a valid token', async () => {
    expect((await request(h.app).get('/api/devices')).status).toBe(401);
    expect((await request(h.app).get('/api/devices').set(auth('garbage'))).status).toBe(401);
  });

  it('rejects bad credentials and audits the failure', async () => {
    const res = await request(h.app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    const audit = h.repos.audit.list().find((e) => e.action === 'login' && e.outcome === 'failed');
    expect(audit?.actor).toBe('admin');
  });

  it('returns the current user without the password hash', async () => {
    const res = await request(h.app).get('/api/auth/me').set(auth(operator));
    expect(res.body.user).toMatchObject({ username: 'operator', role: 'operator' });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('viewers cannot send device commands (403, audited)', async () => {
    const res = await request(h.app)
      .post('/api/devices/light-kitchen/commands')
      .set(auth(viewer))
      .send({ action: 'setPower', on: true });
    expect(res.status).toBe(403);
    expect(h.repos.audit.list()[0]).toMatchObject({ actor: 'viewer', outcome: 'denied' });
  });

  it('only admins can manage rules or read the audit log', async () => {
    expect((await request(h.app).get('/api/system/audit').set(auth(operator))).status).toBe(403);
    expect((await request(h.app).get('/api/system/audit').set(auth(admin))).status).toBe(200);
  });
});

describe('Device API', () => {
  it('lists devices with simulated origin', async () => {
    const res = await request(h.app).get('/api/devices').set(auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.devices.length).toBeGreaterThanOrEqual(10);
    expect(res.body.devices.every((d: { origin: string }) => d.origin === 'simulated')).toBe(true);
  });

  it('operator can switch a light and set brightness', async () => {
    let res = await request(h.app).post('/api/devices/light-kitchen/commands').set(auth(operator)).send({ action: 'setPower', on: true });
    expect(res.status).toBe(200);
    expect(res.body.device.state.on).toBe(true);
    res = await request(h.app).post('/api/devices/light-kitchen/commands').set(auth(operator)).send({ action: 'setBrightness', level: 35 });
    expect(res.body.device.state).toEqual({ on: true, brightness: 35 });
  });

  it('operator can change the thermostat target', async () => {
    const res = await request(h.app).post('/api/devices/thermo-main/commands').set(auth(operator)).send({ action: 'setTarget', celsius: 23 });
    expect(res.status).toBe(200);
    expect(res.body.device.state.targetC).toBe(23);
  });

  it('validates commands: schema → 400, wrong device type → 422, unknown device → 404', async () => {
    let res = await request(h.app).post('/api/devices/light-kitchen/commands').set(auth(operator)).send({ action: 'setBrightness', level: 900 });
    expect(res.status).toBe(400);
    expect(res.body.details?.[0]?.path).toBe('level');
    res = await request(h.app).post('/api/devices/smoke-kitchen/commands').set(auth(operator)).send({ action: 'setPower', on: false });
    expect(res.status).toBe(422);
    res = await request(h.app).post('/api/devices/nope/commands').set(auth(operator)).send({ action: 'setPower', on: false });
    expect(res.status).toBe(404);
    res = await request(h.app).post('/api/devices/bad id!/commands').set(auth(operator)).send({ action: 'setPower', on: false });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(h.app)
      .post('/api/devices/light-kitchen/commands')
      .set(auth(operator))
      .set('Content-Type', 'application/json')
      .send('{"action":');
    expect(res.status).toBe(400);
  });

  it('returns telemetry history for sensors', async () => {
    h.simulator!.tick(2000);
    h.simulator!.tick(2000);
    const res = await request(h.app).get('/api/devices/co-utility/history').set(auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.metric).toBe('co_ppm');
    expect(res.body.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Alerts, events and simulation API', () => {
  it('simulation scenario → alert → acknowledge → resolve', async () => {
    let res = await request(h.app).post('/api/simulation/scenario').set(auth(operator)).send({ scenario: 'co', deviceId: 'co-bedroom' });
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    await h.hub.engine.idle();

    res = await request(h.app).get('/api/alerts?status=open').set(auth(viewer));
    const alert = res.body.alerts.find((a: { deviceId: string }) => a.deviceId === 'co-bedroom');
    expect(alert).toMatchObject({ category: 'co', simulated: true, status: 'active' });

    expect((await request(h.app).post(`/api/alerts/${alert.id}/acknowledge`).set(auth(viewer))).status).toBe(403);
    res = await request(h.app).post(`/api/alerts/${alert.id}/acknowledge`).set(auth(operator));
    expect(res.body.alert).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'operator' });
    expect((await request(h.app).post(`/api/alerts/${alert.id}/acknowledge`).set(auth(operator))).status).toBe(409);
    res = await request(h.app).post(`/api/alerts/${alert.id}/resolve`).set(auth(operator));
    expect(res.body.alert.status).toBe('resolved');
  });

  it('lists events filtered by priority', async () => {
    const res = await request(h.app).get('/api/events?priority=high&limit=50').set(auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.events.every((e: { priority: string }) => e.priority === 'high')).toBe(true);
    expect((await request(h.app).get('/api/events?priority=urgent').set(auth(viewer))).status).toBe(400);
  });

  it('admin can create, toggle and delete a rule', async () => {
    let res = await request(h.app)
      .post('/api/rules')
      .set(auth(admin))
      .send({
        name: 'Kitchen smoke → kitchen light',
        trigger: { type: 'threshold', metric: 'obscuration', op: '>', value: 5, deviceId: 'smoke-kitchen' },
        actions: [{ type: 'device_command', deviceId: 'light-kitchen', command: { action: 'setPower', on: true } }],
      });
    expect(res.status).toBe(201);
    const id = res.body.rule.id;
    expect(res.body.rule.cooldownMs).toBe(30000);

    res = await request(h.app).patch(`/api/rules/${id}`).set(auth(admin)).send({ enabled: false });
    expect(res.body.rule.enabled).toBe(false);
    expect((await request(h.app).patch(`/api/rules/${id}`).set(auth(operator)).send({ enabled: true })).status).toBe(403);
    expect((await request(h.app).delete(`/api/rules/${id}`).set(auth(admin))).status).toBe(204);
    expect((await request(h.app).delete(`/api/rules/${id}`).set(auth(admin))).status).toBe(404);
  });

  it('rejects invalid rule definitions', async () => {
    const res = await request(h.app)
      .post('/api/rules')
      .set(auth(admin))
      .send({ name: 'x', trigger: { type: 'threshold', metric: 'co_ppm', op: '>=', value: 1 }, actions: [] });
    expect(res.status).toBe(400);
  });

  it('overview reports counts and engine stats', async () => {
    const res = await request(h.app).get('/api/system/overview').set(auth(viewer));
    expect(res.body.overview).toMatchObject({ devicesTotal: 17, simulationRunning: true });
    expect(res.body.overview.engine.processed).toBeGreaterThan(0);
    expect(res.body.adapters[0]).toMatchObject({ id: 'sim', origin: 'simulated' });
  });

  it('activity buckets cover the requested window', async () => {
    const res = await request(h.app).get('/api/system/activity?minutes=15').set(auth(viewer));
    expect(res.body.buckets).toHaveLength(15);
    expect(res.body.buckets.reduce((n: number, b: { count: number }) => n + b.count, 0)).toBeGreaterThan(0);
  });

  it('unknown API routes return JSON 404', async () => {
    const res = await request(h.app).get('/api/does-not-exist').set(auth(viewer));
    expect(res.status).toBe(404);
  });
});
