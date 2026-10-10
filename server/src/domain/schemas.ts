import { z } from 'zod';
import type { DeviceCommand, RuleAction, RuleTrigger, SensorReading } from './types.js';

/**
 * Runtime validation for everything that crosses a trust boundary:
 * user commands (API), sensor readings (adapters / bridge) and rule definitions.
 */

export const ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'must contain only letters, digits, "_", "-" or "."');

export const DeviceCommandSchema: z.ZodType<DeviceCommand> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setPower'), on: z.boolean() }).strict(),
  z.object({ action: z.literal('setBrightness'), level: z.number().int().min(0).max(100) }).strict(),
  z.object({ action: z.literal('setTarget'), celsius: z.number().min(10).max(30).multipleOf(0.5) }).strict(),
  z.object({ action: z.literal('setMode'), mode: z.enum(['off', 'heat', 'cool', 'auto']) }).strict(),
  z
    .object({ action: z.literal('setSecurityMode'), mode: z.enum(['disarmed', 'armed_home', 'armed_away']) })
    .strict(),
  z.object({ action: z.literal('silenceSiren') }).strict(),
]);

/** Physical plausibility limits for sensor readings. Out-of-range values are rejected as faulty. */
export const READING_LIMITS = {
  temperature: { min: -40, max: 85 },
  obscuration: { min: 0, max: 100 },
  co_ppm: { min: 0, max: 2000 },
  battery: { min: 0, max: 100 },
} as const;

const finite = z.number().finite();

export const SensorReadingSchema: z.ZodType<SensorReading> = z.discriminatedUnion('metric', [
  z.object({ metric: z.literal('temperature'), value: finite.min(READING_LIMITS.temperature.min).max(READING_LIMITS.temperature.max) }),
  z.object({ metric: z.literal('obscuration'), value: finite.min(READING_LIMITS.obscuration.min).max(READING_LIMITS.obscuration.max) }),
  z.object({ metric: z.literal('co_ppm'), value: finite.min(READING_LIMITS.co_ppm.min).max(READING_LIMITS.co_ppm.max) }),
  z.object({ metric: z.literal('contact_open'), value: z.boolean() }),
  z.object({ metric: z.literal('motion'), value: z.boolean() }),
  z.object({ metric: z.literal('battery'), value: finite.min(0).max(100) }),
]);

export const RuleTriggerSchema: z.ZodType<RuleTrigger> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('motion'), deviceId: ID.optional() }).strict(),
  z.object({ type: z.literal('intrusion'), deviceId: ID.optional(), requireArmed: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('threshold'),
      metric: z.enum(['temperature', 'obscuration', 'co_ppm']),
      op: z.enum(['>', '<']),
      value: z.number().finite().min(-40).max(2000),
      deviceId: ID.optional(),
    })
    .strict(),
  z.object({ type: z.literal('device_offline'), deviceId: ID.optional() }).strict(),
]);

const Category = z.enum(['smoke', 'co', 'intrusion', 'connectivity', 'threshold', 'system']);

export const RuleActionSchema: z.ZodType<RuleAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('device_command'), deviceId: ID, command: DeviceCommandSchema }).strict(),
  z
    .object({
      type: z.literal('lights'),
      on: z.boolean(),
      room: z.string().min(1).max(40).optional(),
      brightness: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('raise_alert'),
      severity: z.enum(['warning', 'critical']),
      category: Category,
      title: z.string().min(1).max(80),
      message: z.string().max(240).optional(),
    })
    .strict(),
  z.object({ type: z.literal('activate_siren') }).strict(),
]);

export const RuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(240).default(''),
    enabled: z.boolean().default(true),
    trigger: RuleTriggerSchema,
    actions: z.array(RuleActionSchema).min(1).max(8),
    cooldownMs: z.number().int().min(0).max(24 * 3600 * 1000).default(30_000),
  })
  .strict();
export type RuleInput = z.infer<typeof RuleInputSchema>;

export const RulePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(240).optional(),
    enabled: z.boolean().optional(),
    trigger: RuleTriggerSchema.optional(),
    actions: z.array(RuleActionSchema).min(1).max(8).optional(),
    cooldownMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  })
  .strict();

export const LoginSchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    scenario: z.enum(['smoke', 'co', 'intrusion', 'motion', 'disconnect', 'reconnect', 'clear']),
    deviceId: ID.optional(),
  })
  .strict();
