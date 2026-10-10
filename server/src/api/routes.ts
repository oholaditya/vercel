import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  DeviceCommandSchema,
  ID,
  LoginSchema,
  RuleInputSchema,
  RulePatchSchema,
  ScenarioSchema,
} from '../domain/schemas.js';
import type { Repositories } from '../db/repositories.js';
import type { Hub } from '../engine/Hub.js';
import { PRIMARY_METRIC } from '../devices/Device.js';
import { requireAuth, requireRole, type AuthService } from '../auth/auth.js';
import { ah, HttpError, parse } from './middleware/errors.js';

export interface ApiDeps {
  hub: Hub;
  repos: Repositories;
  auth: AuthService;
  loginRateLimit?: number;
}

const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
const actor = (req: Request) => req.user?.username ?? 'anonymous';

export function createApiRouter({ hub, repos, auth, loginRateLimit = 20 }: ApiDeps): Router {
  const api = Router();
  const denied = (req: Request) =>
    repos.audit.log(actor(req), `${req.method} ${req.baseUrl}${req.path}`, 'denied', `role=${req.user?.role}`, ip(req));
  const operator = requireRole('operator', denied);
  const admin = requireRole('admin', denied);

  // ------------------------------------------------------------- public
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: loginRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, try again later' },
    handler: (req, res, _next, options) => {
      repos.audit.log('anonymous', 'login', 'denied', 'rate limited', ip(req));
      res.status(options.statusCode).json(options.message);
    },
  });

  api.post(
    '/auth/login',
    loginLimiter,
    ah(async (req, res) => {
      const { username, password } = parse(LoginSchema, req.body);
      const result = await auth.login(username, password);
      if (!result) {
        repos.audit.log(username, 'login', 'failed', 'invalid credentials', ip(req));
        hub.publish({
          type: 'security.auth', priority: 'high', source: 'security', deviceId: null,
          message: `Failed login attempt for "${username.slice(0, 64)}"`, simulated: false,
        });
        throw new HttpError(401, 'Invalid username or password');
      }
      repos.audit.log(username, 'login', 'success', undefined, ip(req));
      res.json(result);
    }),
  );

  // ------------------------------------------------------------- authenticated
  api.use(requireAuth(auth));

  api.get('/auth/me', (req, res) => {
    res.json({ user: req.user });
  });

  // devices
  api.get('/devices', (_req, res) => {
    res.json({ devices: hub.listDevices() });
  });

  api.get('/devices/:id', (req, res) => {
    const d = hub.getDevice(parse(ID, req.params.id));
    if (!d) throw new HttpError(404, 'Device not found');
    res.json({ device: d });
  });

  api.get('/devices/:id/history', (req, res) => {
    const id = parse(ID, req.params.id);
    const d = hub.getDevice(id);
    if (!d) throw new HttpError(404, 'Device not found');
    const q = parse(
      z.object({ metric: z.enum(['temperature', 'obscuration', 'co_ppm']).optional(), limit: z.coerce.number().int().min(1).max(1000).default(120) }),
      req.query,
    );
    const metric = q.metric ?? PRIMARY_METRIC[d.kind];
    if (!metric) throw new HttpError(422, `${d.kind} devices have no numeric telemetry`);
    res.json({ deviceId: id, metric, points: repos.readings.history(id, metric, q.limit) });
  });

  api.post(
    '/devices/:id/commands',
    operator,
    ah(async (req, res) => {
      const id = parse(ID, req.params.id);
      const r = DeviceCommandSchema.safeParse(req.body);
      if (!r.success) {
        repos.audit.log(actor(req), `command:${id}`, 'failed', `invalid command ${JSON.stringify(req.body).slice(0, 200)}`, ip(req));
        throw new HttpError(400, 'Invalid command', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      }
      const device = await hub.executeCommand(id, r.data, actor(req));
      res.json({ device });
    }),
  );

  // rules
  api.get('/rules', (_req, res) => {
    res.json({ rules: hub.automation.list() });
  });

  api.post('/rules', admin, (req, res) => {
    const rule = hub.automation.create(parse(RuleInputSchema, req.body));
    repos.audit.log(actor(req), `rule:create:${rule.id}`, 'success', rule.name, ip(req));
    res.status(201).json({ rule });
  });

  api.patch('/rules/:id', admin, (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const rule = hub.automation.update(id, parse(RulePatchSchema, req.body));
    repos.audit.log(actor(req), `rule:update:${id}`, 'success', JSON.stringify(req.body).slice(0, 200), ip(req));
    res.json({ rule });
  });

  api.delete('/rules/:id', admin, (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    hub.automation.delete(id);
    repos.audit.log(actor(req), `rule:delete:${id}`, 'success', undefined, ip(req));
    res.status(204).end();
  });

  // alerts
  api.get('/alerts', (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['active', 'acknowledged', 'resolved', 'open']).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
      req.query,
    );
    res.json({ alerts: hub.alerts.list(q.status, q.limit) });
  });

  api.post('/alerts/:id/acknowledge', operator, (req, res) => {
    const alert = hub.alerts.acknowledge(parse(z.string().uuid(), req.params.id), actor(req));
    repos.audit.log(actor(req), `alert:ack:${alert.id}`, 'success', alert.title, ip(req));
    res.json({ alert });
  });

  api.post('/alerts/:id/resolve', operator, (req, res) => {
    const alert = hub.alerts.resolve(parse(z.string().uuid(), req.params.id), actor(req));
    repos.audit.log(actor(req), `alert:resolve:${alert.id}`, 'success', alert.title, ip(req));
    res.json({ alert });
  });

  // events
  api.get('/events', (req, res) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
        deviceId: ID.optional(),
        type: z.string().max(40).regex(/^[a-z._]+$/).optional(),
        before: z.string().datetime().optional(),
      }),
      req.query,
    );
    res.json({ events: repos.events.query(q) });
  });

  // system
  api.get('/system/overview', (_req, res) => {
    res.json({ overview: hub.overview(), adapters: hub.adapterStatus() });
  });

  api.get('/system/activity', (req, res) => {
    const q = parse(z.object({ minutes: z.coerce.number().int().min(5).max(240).default(30) }), req.query);
    res.json({ buckets: repos.events.activity(q.minutes) });
  });

  api.get('/system/audit', admin, (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    res.json({ entries: repos.audit.list(q.limit) });
  });

  // simulation (clearly separated from real device control)
  api.post('/simulation/scenario', operator, (req, res) => {
    const { scenario, deviceId } = parse(ScenarioSchema, req.body);
    try {
      const description = hub.runScenario(scenario, deviceId, actor(req));
      repos.audit.log(actor(req), `simulation:${scenario}`, 'success', description, ip(req));
      res.json({ simulated: true, description });
    } catch (err) {
      if (err instanceof Error && !(err instanceof HttpError) && err.name === 'Error') throw new HttpError(422, err.message);
      throw err;
    }
  });

  api.post('/simulation/state', admin, (req, res) => {
    const { running } = parse(z.object({ running: z.boolean() }).strict(), req.body);
    try {
      hub.setSimulationRunning(running, actor(req));
    } catch (err) {
      throw new HttpError(422, (err as Error).message);
    }
    res.json({ running });
  });

  return api;
}
