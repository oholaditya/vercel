/**
 * Browser-only demo backend (used by `vite build --mode demo`, e.g. on Vercel).
 *
 * Runs the REAL hub engine from server/src (Hub, EventEngine, AutomationEngine,
 * AlertManager, device models, SimulatedAdapter, Zod validation) inside the page,
 * against in-memory repositories. Every visitor gets an independent hub; all
 * data is simulated and disappears on reload. Node built-ins used by the engine
 * (node:events, node:crypto) are aliased to small shims in vite.config.ts.
 */
import { ZodError } from 'zod';
import type { DeviceKind, PublicUser, Role, ServerToClientEvents } from '@shared/types';
import { DeviceCommandSchema, RuleInputSchema, RulePatchSchema, ScenarioSchema } from '../../../server/src/domain/schemas';
import { DEFAULT_RULES, SAMPLE_DEVICES } from '../../../server/src/db/sampleData';
import { Hub } from '../../../server/src/engine/Hub';
import { CommandError, PRIMARY_METRIC } from '../../../server/src/devices/Device';
import { AlertError } from '../../../server/src/engine/AlertManager';
import { RuleNotFoundError } from '../../../server/src/engine/AutomationEngine';
import { SimulatedAdapter } from '../../../server/src/devices/adapters/SimulatedAdapter';
import { ApiError, getToken, notifyUnauthorized, type HubApi, type HubSocket } from '../lib/api-core';
import { createMemoryRepositories } from './memoryRepos';

export const IS_DEMO = true;

// The engine schedules its drain loop with setImmediate (Node only).
if (typeof (globalThis as { setImmediate?: unknown }).setImmediate !== 'function') {
  (globalThis as unknown as { setImmediate: (fn: () => void) => number }).setImmediate = (fn) => setTimeout(fn, 0) as unknown as number;
}

export const DEMO_PASSWORD = 'demo';
const DEMO_USERS: Record<string, PublicUser> = {
  admin: { id: 'demo-admin', username: 'admin', role: 'admin' },
  operator: { id: 'demo-operator', username: 'operator', role: 'operator' },
  viewer: { id: 'demo-viewer', username: 'viewer', role: 'viewer' },
};
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

// ------------------------------------------------------------- hub singleton

let hubPromise: Promise<{ hub: Hub; repos: ReturnType<typeof createMemoryRepositories> }> | null = null;

function getHub() {
  hubPromise ??= (async () => {
    const repos = createMemoryRepositories();
    for (const d of SAMPLE_DEVICES) repos.devices.insert({ ...d, adapterId: 'sim', origin: 'simulated' });
    for (const r of DEFAULT_RULES) {
      repos.rules.save({ ...r, id: crypto.randomUUID(), lastFiredAt: null, createdAt: new Date().toISOString() });
    }
    const hub = new Hub({ repos, heartbeatTimeoutMs: 15_000 });
    const sim = new SimulatedAdapter({ tickMs: 2000, autoTick: true });
    sim.register(hub.listDevices());
    hub.simulator = sim;
    await hub.addAdapter(sim);
    hub.start();
    hub.publish({
      type: 'system', priority: 'normal', source: 'system', deviceId: null, simulated: true,
      message: '[DEMO] Hub engine running in this browser tab - all data is simulated and resets on reload',
    });
    return { hub, repos };
  })();
  return hubPromise;
}

// ------------------------------------------------------------- auth + errors

function currentUser(): PublicUser {
  const token = getToken();
  const user = token?.startsWith('demo:') ? DEMO_USERS[token.slice(5)] : undefined;
  if (!user) {
    notifyUnauthorized();
    throw new ApiError(401, 'Authentication required');
  }
  return user;
}

async function guarded<T>(min: Role, action: string, fn: (ctx: Awaited<ReturnType<typeof getHub>>, user: PublicUser) => T | Promise<T>): Promise<T> {
  const user = currentUser();
  const ctx = await getHub();
  if (RANK[user.role] < RANK[min]) {
    ctx.repos.audit.log(user.username, action, 'denied', `role=${user.role}`);
    throw new ApiError(403, `Requires ${min} role`);
  }
  try {
    return await fn(ctx, user);
  } catch (err) {
    throw toApiError(err);
  }
}

function toApiError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    return new ApiError(400, 'Validation failed', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (err instanceof CommandError) return new ApiError(err.code === 'NOT_FOUND' ? 404 : err.code === 'OFFLINE' ? 409 : 422, err.message);
  if (err instanceof AlertError) return new ApiError(err.code === 'NOT_FOUND' ? 404 : 409, err.message);
  if (err instanceof RuleNotFoundError) return new ApiError(404, err.message);
  if (err instanceof RangeError) return new ApiError(422, err.message);
  if (err instanceof Error) return new ApiError(422, err.message);
  return new ApiError(500, 'Unexpected error');
}

// ------------------------------------------------------------- API

export const api: HubApi = {
  async login(username, password) {
    const user = DEMO_USERS[username];
    const { repos } = await getHub();
    if (!user || password !== DEMO_PASSWORD) {
      repos.audit.log(username || 'anonymous', 'login', 'failed', 'invalid demo credentials');
      throw new ApiError(401, `Invalid credentials - in the demo use admin, operator or viewer with password "${DEMO_PASSWORD}"`);
    }
    repos.audit.log(username, 'login', 'success');
    return { token: `demo:${username}`, user };
  },
  async me() {
    return { user: currentUser() };
  },

  devices: () => guarded('viewer', 'devices', ({ hub }) => ({ devices: hub.listDevices() })),
  command: (id, command) =>
    guarded('operator', `command:${id}`, async ({ hub }, user) => {
      const cmd = DeviceCommandSchema.parse(command);
      return { device: await hub.executeCommand(id, cmd, user.username) };
    }),
  history: (id, limit = 120) =>
    guarded('viewer', 'history', ({ hub, repos }) => {
      const d = hub.getDevice(id);
      if (!d) throw new ApiError(404, 'Device not found');
      const metric = PRIMARY_METRIC[d.kind as DeviceKind];
      if (!metric) throw new ApiError(422, `${d.kind} devices have no numeric telemetry`);
      return { metric, points: repos.readings.history(id, metric, limit) };
    }),

  rules: () => guarded('viewer', 'rules', ({ hub }) => ({ rules: hub.automation.list() })),
  createRule: (rule) =>
    guarded('admin', 'rule:create', ({ hub, repos }, user) => {
      const created = hub.automation.create(RuleInputSchema.parse(rule));
      repos.audit.log(user.username, `rule:create:${created.id}`, 'success', created.name);
      return { rule: created };
    }),
  updateRule: (id, patch) =>
    guarded('admin', 'rule:update', ({ hub, repos }, user) => {
      const updated = hub.automation.update(id, RulePatchSchema.parse(patch));
      repos.audit.log(user.username, `rule:update:${id}`, 'success', JSON.stringify(patch).slice(0, 200));
      return { rule: updated };
    }),
  deleteRule: (id) =>
    guarded('admin', 'rule:delete', ({ hub, repos }, user) => {
      hub.automation.delete(id);
      repos.audit.log(user.username, `rule:delete:${id}`, 'success');
    }),

  alerts: (status, limit = 200) => guarded('viewer', 'alerts', ({ hub }) => ({ alerts: hub.alerts.list(status, limit) })),
  acknowledge: (id) =>
    guarded('operator', 'alert:ack', ({ hub, repos }, user) => {
      const alert = hub.alerts.acknowledge(id, user.username);
      repos.audit.log(user.username, `alert:ack:${id}`, 'success', alert.title);
      return { alert };
    }),
  resolve: (id) =>
    guarded('operator', 'alert:resolve', ({ hub, repos }, user) => {
      const alert = hub.alerts.resolve(id, user.username);
      repos.audit.log(user.username, `alert:resolve:${id}`, 'success', alert.title);
      return { alert };
    }),

  events: (q = {}) => guarded('viewer', 'events', ({ repos }) => ({ events: repos.events.query(q) })),

  overview: () =>
    guarded('viewer', 'overview', ({ hub }) => ({
      overview: hub.overview(),
      adapters: [...hub.adapterStatus(), { id: 'browser-demo', origin: 'simulated', connected: true, detail: 'Hub engine running in this browser tab' }],
    })),
  activity: (minutes = 30) => guarded('viewer', 'activity', ({ repos }) => ({ buckets: repos.events.activity(minutes) })),
  audit: (limit = 100) => guarded('admin', 'audit', ({ repos }) => ({ entries: repos.audit.list(limit) })),

  scenario: (scenario, deviceId) =>
    guarded('operator', `simulation:${scenario}`, ({ hub, repos }, user) => {
      const input = ScenarioSchema.parse({ scenario, deviceId });
      const description = hub.runScenario(input.scenario, input.deviceId, user.username);
      repos.audit.log(user.username, `simulation:${scenario}`, 'success', description);
      return { simulated: true as const, description };
    }),
  setSimulation: (running) =>
    guarded('admin', 'simulation:state', ({ hub }, user) => {
      hub.setSimulationRunning(running, user.username);
      return { running };
    }),
};

// ------------------------------------------------------------- real-time channel

/** In-page replacement for Socket.IO: forwards hub events to the UI store. */
export function createHubSocket(token: string): HubSocket {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((h) => h(...args));
  let closed = false;
  const cleanups: Array<() => void> = [];

  void getHub().then(({ hub }) => {
    if (closed || !token.startsWith('demo:')) return emit('connect_error');
    const forward = <K extends keyof ServerToClientEvents>(hubEvent: string, clientEvent: K) => {
      const fn = (payload: unknown) => emit(clientEvent, payload);
      hub.on(hubEvent as never, fn as never);
      cleanups.push(() => hub.off(hubEvent as never, fn as never));
    };
    forward('device', 'device:update');
    forward('event', 'event:new');
    forward('alert', 'alert:upsert');
    forward('rule', 'rule:upsert');
    forward('ruleDeleted', 'rule:delete');
    forward('telemetry', 'telemetry:point');
    const tick = setInterval(() => emit('system:overview', hub.overview()), 2000);
    cleanups.push(() => clearInterval(tick));
    emit('connect');
    emit('system:overview', hub.overview());
  });

  return {
    on(event: string, listener: (...args: never[]) => void) {
      const list = handlers.get(event) ?? [];
      list.push(listener as (...args: unknown[]) => void);
      handlers.set(event, list);
    },
    close() {
      closed = true;
      cleanups.forEach((c) => c());
      handlers.clear();
    },
  } as HubSocket;
}
