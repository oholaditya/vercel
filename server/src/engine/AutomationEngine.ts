import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AlertCategory,
  AlertSeverity,
  AutomationRule,
  DeviceCommand,
  DeviceSnapshot,
  HubEvent,
  RuleAction,
  RuleTrigger,
  SecurityMode,
  SensorReading,
} from '../domain/types.js';
import type { RuleInput } from '../domain/schemas.js';
import type { RuleRepository } from '../db/repositories.js';
import type { EventEngine } from './EventEngine.js';

/** What the automation engine is allowed to do to the rest of the hub. */
export interface AutomationContext {
  devices(): DeviceSnapshot[];
  securityMode(): SecurityMode;
  executeCommand(deviceId: string, command: DeviceCommand, actor: string): Promise<unknown>;
  raiseAlert(input: {
    severity: AlertSeverity;
    category: AlertCategory;
    title: string;
    message: string;
    deviceId: string | null;
    ruleId: string;
    simulated: boolean;
  }): void;
  activateSiren(reason: string, simulated: boolean): void;
}

export class RuleNotFoundError extends Error {}

/**
 * Evaluates rules against processed events.
 *
 * - motion / intrusion / offline triggers fire on each matching event (subject to cooldown);
 * - threshold triggers are EDGE-triggered per (rule, device): they fire when the value
 *   crosses into the alarm region and re-arm only after it leaves it.
 */
export class AutomationEngine extends EventEmitter<{ upsert: [AutomationRule]; delete: [string] }> {
  private rules = new Map<string, AutomationRule>();
  private readonly thresholdLatched = new Set<string>();
  private readonly lastFired = new Map<string, number>();

  constructor(
    private readonly repo: RuleRepository,
    private readonly engine: EventEngine,
    private readonly ctx: AutomationContext,
    private readonly now: () => number = Date.now,
  ) {
    super();
    for (const r of repo.all()) this.rules.set(r.id, r);
  }

  list(): AutomationRule[] {
    return [...this.rules.values()];
  }

  get(id: string): AutomationRule | undefined {
    return this.rules.get(id);
  }

  create(input: RuleInput): AutomationRule {
    this.assertDevicesExist(input.trigger, input.actions);
    const rule: AutomationRule = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      trigger: input.trigger,
      actions: input.actions,
      cooldownMs: input.cooldownMs,
      lastFiredAt: null,
      createdAt: new Date().toISOString(),
    };
    this.repo.save(rule);
    this.rules.set(rule.id, rule);
    this.emit('upsert', rule);
    return rule;
  }

  update(id: string, patch: Partial<RuleInput>): AutomationRule {
    const current = this.rules.get(id);
    if (!current) throw new RuleNotFoundError('Rule not found');
    const next: AutomationRule = { ...current, ...stripUndefined(patch) };
    this.assertDevicesExist(next.trigger, next.actions);
    this.repo.save(next);
    this.rules.set(id, next);
    this.clearLatches(id);
    this.emit('upsert', next);
    return next;
  }

  delete(id: string): void {
    if (!this.rules.has(id)) throw new RuleNotFoundError('Rule not found');
    this.repo.delete(id);
    this.rules.delete(id);
    this.clearLatches(id);
    this.emit('delete', id);
  }

  enabledCount(): number {
    return this.list().filter((r) => r.enabled).length;
  }

  /** Engine subscriber: evaluate every enabled rule against one event. */
  async evaluate(event: HubEvent): Promise<AutomationRule[]> {
    const fired: AutomationRule[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (!this.matches(rule, event)) continue;
      const key = `${rule.id}:${event.deviceId ?? '*'}`;
      const last = this.lastFired.get(key) ?? -Infinity;
      if (this.now() - last < rule.cooldownMs) continue;
      this.lastFired.set(key, this.now());
      fired.push(rule);
      await this.fire(rule, event);
    }
    return fired;
  }

  private matches(rule: AutomationRule, event: HubEvent): boolean {
    const t = rule.trigger;
    if (t.deviceId && t.deviceId !== event.deviceId) return false;

    if (t.type === 'device_offline') return event.type === 'device.offline';
    if (event.type !== 'device.reading') return false;
    const reading = event.data?.reading as SensorReading | undefined;
    if (!reading) return false;

    switch (t.type) {
      case 'motion':
        return reading.metric === 'motion' && reading.value === true;
      case 'intrusion':
        if (reading.metric !== 'contact_open' || reading.value !== true) return false;
        return !t.requireArmed || this.ctx.securityMode() !== 'disarmed';
      case 'threshold': {
        if (reading.metric !== t.metric) return false;
        const value = reading.value as number;
        const inAlarm = t.op === '>' ? value > t.value : value < t.value;
        const latchKey = `${rule.id}:${event.deviceId}`;
        if (!inAlarm) {
          this.thresholdLatched.delete(latchKey);
          return false;
        }
        if (this.thresholdLatched.has(latchKey)) return false;
        this.thresholdLatched.add(latchKey);
        return true;
      }
    }
  }

  private async fire(rule: AutomationRule, event: HubEvent) {
    const firedAt = new Date().toISOString();
    const updated = { ...rule, lastFiredAt: firedAt };
    this.rules.set(rule.id, updated);
    this.repo.save(updated);
    this.emit('upsert', updated);

    this.engine.publish({
      type: 'automation.fired',
      priority: 'normal',
      source: 'automation',
      deviceId: event.deviceId,
      message: `Rule "${rule.name}" fired`,
      simulated: event.simulated,
      data: { ruleId: rule.id, trigger: rule.trigger.type },
    });

    for (const action of rule.actions) {
      try {
        await this.runAction(rule, action, event);
      } catch (err) {
        this.engine.publish({
          type: 'device.command_failed',
          priority: 'high',
          source: 'automation',
          deviceId: action.type === 'device_command' ? action.deviceId : event.deviceId,
          message: `Rule "${rule.name}" action ${action.type} failed: ${(err as Error).message}`,
          simulated: event.simulated,
        });
      }
    }
  }

  private async runAction(rule: AutomationRule, action: RuleAction, event: HubEvent) {
    const actor = `automation:${rule.name}`;
    switch (action.type) {
      case 'device_command':
        await this.ctx.executeCommand(action.deviceId, action.command, actor);
        return;
      case 'lights': {
        const source = event.deviceId ? this.ctx.devices().find((d) => d.id === event.deviceId) : undefined;
        // room "*" = every light; no room = the room of the triggering device.
        const room = action.room === '*' ? undefined : (action.room ?? source?.room);
        const lights = this.ctx.devices().filter((d) => d.kind === 'light' && (!room || d.room === room));
        for (const l of lights) {
          if (action.on && action.brightness !== undefined) {
            await this.ctx.executeCommand(l.id, { action: 'setBrightness', level: action.brightness }, actor);
          } else {
            await this.ctx.executeCommand(l.id, { action: 'setPower', on: action.on }, actor);
          }
        }
        return;
      }
      case 'raise_alert': {
        const device = event.deviceId ? this.ctx.devices().find((d) => d.id === event.deviceId) : undefined;
        const reading = event.data?.reading as SensorReading | undefined;
        const detail = reading && typeof reading.value === 'number' ? ` (reading ${reading.value})` : '';
        this.ctx.raiseAlert({
          severity: action.severity,
          category: action.category,
          title: action.title,
          message: action.message ?? `${action.title} - ${device?.name ?? 'system'}${detail}`,
          deviceId: event.deviceId,
          ruleId: rule.id,
          simulated: event.simulated,
        });
        return;
      }
      case 'activate_siren':
        this.ctx.activateSiren(`Rule "${rule.name}"`, event.simulated);
        return;
    }
  }

  private assertDevicesExist(trigger: RuleTrigger, actions: RuleAction[]) {
    const ids = new Set(this.ctx.devices().map((d) => d.id));
    const refs = [trigger.deviceId, ...actions.map((a) => (a.type === 'device_command' ? a.deviceId : undefined))];
    for (const id of refs) {
      if (id && !ids.has(id)) throw new RangeError(`Unknown device "${id}"`);
    }
  }

  private clearLatches(ruleId: string) {
    for (const k of [...this.thresholdLatched]) if (k.startsWith(`${ruleId}:`)) this.thresholdLatched.delete(k);
    for (const k of [...this.lastFired.keys()]) if (k.startsWith(`${ruleId}:`)) this.lastFired.delete(k);
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
