import crypto from 'node:crypto';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().default('./data/hub.db'),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  ADMIN_USERNAME: z.string().min(3).default('admin'),
  ADMIN_PASSWORD: z.string().optional(),
  OPERATOR_USERNAME: z.string().min(3).optional(),
  OPERATOR_PASSWORD: z.string().optional(),
  VIEWER_USERNAME: z.string().min(3).optional(),
  VIEWER_PASSWORD: z.string().optional(),
  SIMULATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SIMULATION_TICK_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(15000),
  BRIDGE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  BRIDGE_PORT: z.coerce.number().int().min(0).max(65535).default(7400),
  BRIDGE_HOST: z.string().default('127.0.0.1'),
  BRIDGE_TOKEN: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

const MIN_SECRET = 32;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === 'production';
  const warnings: string[] = [];

  let jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < MIN_SECRET) {
    if (isProd) throw new Error(`JWT_SECRET must be set and at least ${MIN_SECRET} characters in production.`);
    jwtSecret = crypto.randomBytes(48).toString('hex');
    warnings.push('JWT_SECRET missing or too short - generated an ephemeral secret (sessions reset on restart).');
  }

  let adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (isProd) throw new Error('ADMIN_PASSWORD must be set in production.');
    adminPassword = crypto.randomBytes(9).toString('base64url');
    warnings.push(`ADMIN_PASSWORD not set - generated a one-time password for "${env.ADMIN_USERNAME}": ${adminPassword}`);
  }
  if (adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');

  if (env.BRIDGE_ENABLED && (!env.BRIDGE_TOKEN || env.BRIDGE_TOKEN.length < 16)) {
    throw new Error('BRIDGE_TOKEN (>= 16 chars) is required when BRIDGE_ENABLED=true.');
  }

  const extraUsers: Array<{ username: string; password: string; role: 'operator' | 'viewer' }> = [];
  if (env.OPERATOR_USERNAME && env.OPERATOR_PASSWORD) {
    extraUsers.push({ username: env.OPERATOR_USERNAME, password: env.OPERATOR_PASSWORD, role: 'operator' });
  }
  if (env.VIEWER_USERNAME && env.VIEWER_PASSWORD) {
    extraUsers.push({ username: env.VIEWER_USERNAME, password: env.VIEWER_PASSWORD, role: 'viewer' });
  }

  return {
    nodeEnv: env.NODE_ENV,
    isProd,
    port: env.PORT,
    host: env.HOST,
    databasePath: env.DATABASE_PATH,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    corsOrigins: env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    admin: { username: env.ADMIN_USERNAME, password: adminPassword },
    extraUsers,
    simulation: { enabled: env.SIMULATION_ENABLED, tickMs: env.SIMULATION_TICK_MS },
    heartbeatTimeoutMs: env.HEARTBEAT_TIMEOUT_MS,
    bridge: {
      enabled: env.BRIDGE_ENABLED,
      port: env.BRIDGE_PORT,
      host: env.BRIDGE_HOST,
      token: env.BRIDGE_TOKEN ?? '',
    },
    warnings,
  };
}
