import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { buildServer, type HubServer } from '../src/app.js';

export const PASSWORDS = {
  admin: 'admin-test-pass-1',
  operator: 'operator-test-pass-1',
  viewer: 'viewer-test-pass-1',
};

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'x'.repeat(48),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: PASSWORDS.admin,
    OPERATOR_USERNAME: 'operator',
    OPERATOR_PASSWORD: PASSWORDS.operator,
    VIEWER_USERNAME: 'viewer',
    VIEWER_PASSWORD: PASSWORDS.viewer,
    SIMULATION_ENABLED: 'true',
    HEARTBEAT_TIMEOUT_MS: '5000',
    ...overrides,
  });
}

export async function createTestHub(overrides: Record<string, string> = {}): Promise<HubServer> {
  return buildServer(testConfig(overrides), { manualSimulation: true, loginRateLimit: 1000, staticDir: '/nonexistent' });
}

export async function login(h: HubServer, role: keyof typeof PASSWORDS): Promise<string> {
  const res = await request(h.app).post('/api/auth/login').send({ username: role, password: PASSWORDS[role] });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

/** Feed a reading through the hub and wait for the engine (and automations) to settle. */
export async function feed(h: HubServer, deviceId: string, reading: unknown) {
  h.hub.ingestReading(deviceId, reading, true);
  await h.hub.engine.idle();
}
