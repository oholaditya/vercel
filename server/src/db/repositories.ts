import type { Db } from './database.js';
import type {
  ActivityBucket,
  Alert,
  AlertStatus,
  AutomationRule,
  DeviceKind,
  DeviceSnapshot,
  EventPriority,
  HubEvent,
  Role,
  TelemetryPoint,
} from '../domain/types.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ------------------------------------------------------------------ users

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  findByUsername(username: string): UserRecord | null {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Row | undefined;
    return r ? this.map(r) : null;
  }

  findById(id: string): UserRecord | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r ? this.map(r) : null;
  }

  upsert(u: UserRecord): void {
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role`,
      )
      .run(u.id, u.username, u.passwordHash, u.role, new Date().toISOString());
  }

  private map(r: Row): UserRecord {
    return { id: String(r.id), username: String(r.username), passwordHash: String(r.password_hash), role: r.role as Role };
  }
}

// ------------------------------------------------------------------ devices

export interface DeviceRecord {
  id: string;
  name: string;
  kind: DeviceKind;
  room: string;
  adapterId: string;
  origin: DeviceSnapshot['origin'];
  state: unknown;
}

export class DeviceRepository {
  constructor(private readonly db: Db) {}

  all(): DeviceRecord[] {
    const rows = this.db.prepare('SELECT * FROM devices ORDER BY room, name').all() as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      kind: r.kind as DeviceKind,
      room: String(r.room),
      adapterId: String(r.adapter_id),
      origin: r.origin as DeviceSnapshot['origin'],
      state: JSON.parse(String(r.state_json)),
    }));
  }

  count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number };
    return Number(r.n);
  }

  insert(d: DeviceRecord): void {
    this.db
      .prepare(
        'INSERT INTO devices (id, name, kind, room, adapter_id, origin, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(d.id, d.name, d.kind, d.room, d.adapterId, d.origin, JSON.stringify(d.state), new Date().toISOString());
  }

  saveState(id: string, state: unknown): void {
    this.db.prepare('UPDATE devices SET state_json = ? WHERE id = ?').run(JSON.stringify(state), id);
  }
}

// ------------------------------------------------------------------ rules

export class RuleRepository {
  constructor(private readonly db: Db) {}

  all(): AutomationRule[] {
    const rows = this.db.prepare('SELECT * FROM rules ORDER BY created_at').all() as Row[];
    return rows.map((r) => this.map(r));
  }

  get(id: string): AutomationRule | null {
    const r = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Row | undefined;
    return r ? this.map(r) : null;
  }

  count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number };
    return Number(r.n);
  }

  save(rule: AutomationRule): void {
    this.db
      .prepare(
        `INSERT INTO rules (id, name, description, enabled, trigger_json, actions_json, cooldown_ms, last_fired_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
           enabled = excluded.enabled, trigger_json = excluded.trigger_json, actions_json = excluded.actions_json,
           cooldown_ms = excluded.cooldown_ms, last_fired_at = excluded.last_fired_at`,
      )
      .run(
        rule.id,
        rule.name,
        rule.description,
        rule.enabled ? 1 : 0,
        JSON.stringify(rule.trigger),
        JSON.stringify(rule.actions),
        rule.cooldownMs,
        rule.lastFiredAt,
        rule.createdAt,
      );
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes) > 0;
  }

  private map(r: Row): AutomationRule {
    return {
      id: String(r.id),
      name: String(r.name),
      description: String(r.description ?? ''),
      enabled: Number(r.enabled) === 1,
      trigger: JSON.parse(String(r.trigger_json)),
      actions: JSON.parse(String(r.actions_json)),
      cooldownMs: Number(r.cooldown_ms),
      lastFiredAt: str(r.last_fired_at),
      createdAt: String(r.created_at),
    };
  }
}

// ------------------------------------------------------------------ events

export interface EventQuery {
  limit?: number;
  priority?: EventPriority;
  deviceId?: string;
  type?: string;
  before?: string;
}

export class EventRepository {
  constructor(private readonly db: Db) {}

  insert(e: HubEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (id, ts, type, priority, source, device_id, message, simulated, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.ts, e.type, e.priority, e.source, e.deviceId, e.message, e.simulated ? 1 : 0, e.data ? JSON.stringify(e.data) : null);
  }

  query(q: EventQuery = {}): HubEvent[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (q.priority) { where.push('priority = ?'); params.push(q.priority); }
    if (q.deviceId) { where.push('device_id = ?'); params.push(q.deviceId); }
    if (q.type) { where.push('type = ?'); params.push(q.type); }
    if (q.before) { where.push('ts < ?'); params.push(q.before); }
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      ts: String(r.ts),
      type: r.type as HubEvent['type'],
      priority: r.priority as EventPriority,
      source: r.source as HubEvent['source'],
      deviceId: str(r.device_id),
      message: String(r.message),
      simulated: Number(r.simulated) === 1,
      ...(r.data_json ? { data: JSON.parse(String(r.data_json)) } : {}),
    }));
  }

  /** Event counts per minute for the last `minutes` minutes (oldest first, gaps filled with 0). */
  activity(minutes: number, now = new Date()): ActivityBucket[] {
    const since = new Date(now.getTime() - minutes * 60_000);
    const rows = this.db
      .prepare(
        `SELECT substr(ts, 1, 16) AS bucket, COUNT(*) AS n FROM events
         WHERE ts >= ? AND type != 'device.reading' GROUP BY bucket`,
      )
      .all(since.toISOString()) as Array<{ bucket: string; n: number }>;
    const counts = new Map(rows.map((r) => [r.bucket, Number(r.n)]));
    const out: ActivityBucket[] = [];
    for (let i = minutes - 1; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 60_000);
      const key = t.toISOString().slice(0, 16);
      out.push({ ts: `${key}:00.000Z`, count: counts.get(key) ?? 0 });
    }
    return out;
  }

  prune(keep: number): void {
    this.db
      .prepare('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT ?)')
      .run(keep);
  }
}

// ------------------------------------------------------------------ alerts

export class AlertRepository {
  constructor(private readonly db: Db) {}

  save(a: Alert): void {
    this.db
      .prepare(
        `INSERT INTO alerts (id, ts, severity, category, title, message, device_id, rule_id, status,
           acknowledged_by, acknowledged_at, resolved_at, simulated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, acknowledged_by = excluded.acknowledged_by,
           acknowledged_at = excluded.acknowledged_at, resolved_at = excluded.resolved_at,
           title = excluded.title, message = excluded.message, severity = excluded.severity`,
      )
      .run(
        a.id, a.ts, a.severity, a.category, a.title, a.message, a.deviceId, a.ruleId, a.status,
        a.acknowledgedBy, a.acknowledgedAt, a.resolvedAt, a.simulated ? 1 : 0,
      );
  }

  get(id: string): Alert | null {
    const r = this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Row | undefined;
    return r ? this.map(r) : null;
  }

  list(status?: AlertStatus | 'open', limit = 200): Alert[] {
    let sql = 'SELECT * FROM alerts';
    const params: Array<string | number> = [];
    if (status === 'open') sql += " WHERE status IN ('active','acknowledged')";
    else if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY ts DESC LIMIT ?';
    params.push(Math.min(Math.max(limit, 1), 500));
    return (this.db.prepare(sql).all(...params) as Row[]).map((r) => this.map(r));
  }

  private map(r: Row): Alert {
    return {
      id: String(r.id),
      ts: String(r.ts),
      severity: r.severity as Alert['severity'],
      category: r.category as Alert['category'],
      title: String(r.title),
      message: String(r.message),
      deviceId: str(r.device_id),
      ruleId: str(r.rule_id),
      status: r.status as AlertStatus,
      acknowledgedBy: str(r.acknowledged_by),
      acknowledgedAt: str(r.acknowledged_at),
      resolvedAt: str(r.resolved_at),
      simulated: Number(r.simulated) === 1,
    };
  }
}

// ------------------------------------------------------------------ readings

export class ReadingRepository {
  constructor(private readonly db: Db) {}

  insert(deviceId: string, metric: string, ts: string, value: number): void {
    this.db.prepare('INSERT INTO readings (device_id, metric, ts, value) VALUES (?, ?, ?, ?)').run(deviceId, metric, ts, value);
  }

  history(deviceId: string, metric: string, limit = 120): TelemetryPoint[] {
    const rows = this.db
      .prepare('SELECT ts, value FROM readings WHERE device_id = ? AND metric = ? ORDER BY ts DESC LIMIT ?')
      .all(deviceId, metric, Math.min(Math.max(limit, 1), 1000)) as Array<{ ts: string; value: number }>;
    return rows.reverse().map((r) => ({ ts: String(r.ts), value: Number(r.value) }));
  }

  pruneOlderThan(iso: string): void {
    this.db.prepare('DELETE FROM readings WHERE ts < ?').run(iso);
  }
}

// ------------------------------------------------------------------ audit

export type AuditOutcome = 'success' | 'denied' | 'failed';
export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  outcome: AuditOutcome;
  ip: string | null;
  detail: string | null;
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  log(actor: string, action: string, outcome: AuditOutcome, detail?: string, ip?: string): void {
    this.db
      .prepare('INSERT INTO audit_log (ts, actor, action, outcome, ip, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), actor, action, outcome, ip ?? null, detail ? detail.slice(0, 500) : null);
  }

  list(limit = 100): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 500)) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      actor: String(r.actor),
      action: String(r.action),
      outcome: r.outcome as AuditOutcome,
      ip: str(r.ip),
      detail: str(r.detail),
    }));
  }
}

export interface Repositories {
  users: UserRepository;
  devices: DeviceRepository;
  rules: RuleRepository;
  events: EventRepository;
  alerts: AlertRepository;
  readings: ReadingRepository;
  audit: AuditRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    users: new UserRepository(db),
    devices: new DeviceRepository(db),
    rules: new RuleRepository(db),
    events: new EventRepository(db),
    alerts: new AlertRepository(db),
    readings: new ReadingRepository(db),
    audit: new AuditRepository(db),
  };
}
