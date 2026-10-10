import type {
  ActivityBucket,
  Alert,
  AlertStatus,
  AutomationRule,
  HubEvent,
  TelemetryPoint,
} from '@shared/types';
import type { AuditEntry, AuditOutcome, DeviceRecord, EventQuery, Repositories } from '../../../server/src/db/repositories';

/**
 * In-memory implementations of the server repositories, used by the
 * browser-only demo. Same method signatures as server/src/db/repositories.ts
 * (SQLite); data lives only for the lifetime of the page.
 */

const MAX_EVENTS = 5000;
const MAX_READINGS_PER_SERIES = 600;

class DeviceMemRepo {
  private readonly rows = new Map<string, DeviceRecord>();
  all(): DeviceRecord[] {
    return [...this.rows.values()].sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name));
  }
  count(): number {
    return this.rows.size;
  }
  insert(d: DeviceRecord): void {
    this.rows.set(d.id, structuredClone(d));
  }
  saveState(id: string, state: unknown): void {
    const r = this.rows.get(id);
    if (r) r.state = structuredClone(state);
  }
}

class RuleMemRepo {
  private readonly rows = new Map<string, AutomationRule>();
  all(): AutomationRule[] {
    return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => structuredClone(r));
  }
  get(id: string): AutomationRule | null {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }
  count(): number {
    return this.rows.size;
  }
  save(rule: AutomationRule): void {
    this.rows.set(rule.id, structuredClone(rule));
  }
  delete(id: string): boolean {
    return this.rows.delete(id);
  }
}

class EventMemRepo {
  private rows: HubEvent[] = []; // newest first
  insert(e: HubEvent): void {
    this.rows.unshift(e);
    if (this.rows.length > MAX_EVENTS) this.rows.length = MAX_EVENTS;
  }
  query(q: EventQuery = {}): HubEvent[] {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    return this.rows
      .filter(
        (e) =>
          (!q.priority || e.priority === q.priority) &&
          (!q.deviceId || e.deviceId === q.deviceId) &&
          (!q.type || e.type === q.type) &&
          (!q.before || e.ts < q.before),
      )
      .slice(0, limit);
  }
  activity(minutes: number, now = new Date()): ActivityBucket[] {
    const counts = new Map<string, number>();
    const since = now.getTime() - minutes * 60_000;
    for (const e of this.rows) {
      if (Date.parse(e.ts) < since) break;
      if (e.type === 'device.reading') continue;
      const k = e.ts.slice(0, 16);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const out: ActivityBucket[] = [];
    for (let i = minutes - 1; i >= 0; i--) {
      const key = new Date(now.getTime() - i * 60_000).toISOString().slice(0, 16);
      out.push({ ts: `${key}:00.000Z`, count: counts.get(key) ?? 0 });
    }
    return out;
  }
  prune(keep: number): void {
    if (this.rows.length > keep) this.rows.length = keep;
  }
}

class AlertMemRepo {
  private readonly rows = new Map<string, Alert>();
  save(a: Alert): void {
    this.rows.set(a.id, structuredClone(a));
  }
  get(id: string): Alert | null {
    const a = this.rows.get(id);
    return a ? structuredClone(a) : null;
  }
  list(status?: AlertStatus | 'open', limit = 200): Alert[] {
    return [...this.rows.values()]
      .filter((a) => (status === 'open' ? a.status !== 'resolved' : !status || a.status === status))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((a) => structuredClone(a));
  }
}

class ReadingMemRepo {
  private readonly series = new Map<string, TelemetryPoint[]>();
  insert(deviceId: string, metric: string, ts: string, value: number): void {
    const key = `${deviceId}:${metric}`;
    const s = this.series.get(key) ?? [];
    s.push({ ts, value });
    if (s.length > MAX_READINGS_PER_SERIES) s.shift();
    this.series.set(key, s);
  }
  history(deviceId: string, metric: string, limit = 120): TelemetryPoint[] {
    return (this.series.get(`${deviceId}:${metric}`) ?? []).slice(-Math.min(Math.max(limit, 1), 1000));
  }
  pruneOlderThan(iso: string): void {
    for (const [k, s] of this.series) this.series.set(k, s.filter((p) => p.ts >= iso));
  }
}

class AuditMemRepo {
  private rows: AuditEntry[] = [];
  private seq = 0;
  log(actor: string, action: string, outcome: AuditOutcome, detail?: string, ip?: string): void {
    this.rows.unshift({ id: ++this.seq, ts: new Date().toISOString(), actor, action, outcome, ip: ip ?? null, detail: detail ? detail.slice(0, 500) : null });
    if (this.rows.length > 1000) this.rows.length = 1000;
  }
  list(limit = 100): AuditEntry[] {
    return this.rows.slice(0, Math.min(Math.max(limit, 1), 500));
  }
}

export function createMemoryRepositories() {
  const repos = {
    users: null, // demo users are handled by the demo auth layer
    devices: new DeviceMemRepo(),
    rules: new RuleMemRepo(),
    events: new EventMemRepo(),
    alerts: new AlertMemRepo(),
    readings: new ReadingMemRepo(),
    audit: new AuditMemRepo(),
  };
  // The SQLite repository classes have private fields, so they are nominally
  // typed; these in-memory classes are structurally equivalent.
  return repos as unknown as Repositories & { audit: AuditMemRepo };
}
