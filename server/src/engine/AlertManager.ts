import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Alert, AlertCategory, AlertSeverity } from '../domain/types.js';
import type { AlertRepository } from '../db/repositories.js';
import type { EventEngine } from './EventEngine.js';

export interface RaiseAlertInput {
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  deviceId: string | null;
  ruleId: string | null;
  simulated: boolean;
}

export class AlertError extends Error {
  constructor(message: string, readonly code: 'NOT_FOUND' | 'INVALID_STATE') {
    super(message);
  }
}

/**
 * Owns alert lifecycle: active -> acknowledged -> resolved.
 * Open alerts are de-duplicated per (category, device) so a sustained condition
 * produces one alert that may escalate, not a flood.
 */
export class AlertManager extends EventEmitter<{ upsert: [Alert] }> {
  constructor(private readonly repo: AlertRepository, private readonly engine: EventEngine) {
    super();
  }

  raise(input: RaiseAlertInput): { alert: Alert; created: boolean } {
    const existing = this.repo
      .list('open', 500)
      .find((a) => a.category === input.category && a.deviceId === input.deviceId);

    if (existing) {
      if (existing.severity === 'warning' && input.severity === 'critical') {
        const escalated: Alert = { ...existing, severity: 'critical', title: input.title, message: input.message, status: 'active' };
        this.repo.save(escalated);
        this.emit('upsert', escalated);
        this.publish(escalated, 'alert.raised', `ESCALATED: ${escalated.title}`);
        return { alert: escalated, created: false };
      }
      return { alert: existing, created: false };
    }

    const alert: Alert = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      severity: input.severity,
      category: input.category,
      title: input.title,
      message: input.message,
      deviceId: input.deviceId,
      ruleId: input.ruleId,
      status: 'active',
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedAt: null,
      simulated: input.simulated,
    };
    this.repo.save(alert);
    this.emit('upsert', alert);
    this.publish(alert, 'alert.raised', alert.title);
    return { alert, created: true };
  }

  acknowledge(id: string, username: string): Alert {
    const a = this.repo.get(id);
    if (!a) throw new AlertError('Alert not found', 'NOT_FOUND');
    if (a.status !== 'active') throw new AlertError(`Alert is already ${a.status}`, 'INVALID_STATE');
    const next: Alert = { ...a, status: 'acknowledged', acknowledgedBy: username, acknowledgedAt: new Date().toISOString() };
    this.repo.save(next);
    this.emit('upsert', next);
    this.publish(next, 'alert.acknowledged', `Acknowledged by ${username}: ${a.title}`);
    return next;
  }

  resolve(id: string, actor: string): Alert {
    const a = this.repo.get(id);
    if (!a) throw new AlertError('Alert not found', 'NOT_FOUND');
    if (a.status === 'resolved') throw new AlertError('Alert is already resolved', 'INVALID_STATE');
    const next: Alert = {
      ...a,
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      acknowledgedBy: a.acknowledgedBy ?? actor,
      acknowledgedAt: a.acknowledgedAt ?? new Date().toISOString(),
    };
    this.repo.save(next);
    this.emit('upsert', next);
    this.publish(next, 'alert.resolved', `Resolved by ${actor}: ${a.title}`);
    return next;
  }

  /** Auto-resolve open alerts of a category for a device (e.g. connectivity restored). */
  resolveFor(category: AlertCategory, deviceId: string, actor = 'system'): void {
    for (const a of this.repo.list('open', 500)) {
      if (a.category === category && a.deviceId === deviceId) this.resolve(a.id, actor);
    }
  }

  list(status?: Alert['status'] | 'open', limit?: number): Alert[] {
    return this.repo.list(status, limit);
  }

  openCounts(): { total: number; critical: number; unacknowledged: number } {
    const open = this.repo.list('open', 500);
    return {
      total: open.length,
      critical: open.filter((a) => a.severity === 'critical').length,
      unacknowledged: open.filter((a) => a.status === 'active').length,
    };
  }

  private publish(a: Alert, type: 'alert.raised' | 'alert.acknowledged' | 'alert.resolved', message: string) {
    this.engine.publish({
      type,
      priority: type === 'alert.raised' ? (a.severity === 'critical' ? 'critical' : 'high') : 'normal',
      source: type === 'alert.raised' ? 'automation' : 'user',
      deviceId: a.deviceId,
      message,
      simulated: a.simulated,
      data: { alertId: a.id, severity: a.severity, category: a.category },
    });
  }
}
