import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Repositories } from './repositories.js';
import type { AppConfig } from '../config/env.js';
import { DEFAULT_RULES, SAMPLE_DEVICES } from './sampleData.js';

export { DEFAULT_RULES, SAMPLE_DEVICES };

export function seedDatabase(repos: Repositories, config: Pick<AppConfig, 'admin' | 'extraUsers'>): void {
  if (repos.devices.count() === 0) {
    for (const d of SAMPLE_DEVICES) {
      repos.devices.insert({ ...d, adapterId: 'sim', origin: 'simulated' });
    }
  }
  if (repos.rules.count() === 0) {
    for (const r of DEFAULT_RULES) {
      repos.rules.save({ ...r, id: crypto.randomUUID(), lastFiredAt: null, createdAt: new Date().toISOString() });
    }
  }
  // Users are (re)synchronised from the environment on every start so a password
  // change in .env takes effect. Hash cost 10 keeps tests fast while remaining sane.
  const users = [{ ...config.admin, role: 'admin' as const }, ...config.extraUsers];
  for (const u of users) {
    const existing = repos.users.findByUsername(u.username);
    repos.users.upsert({
      id: existing?.id ?? crypto.randomUUID(),
      username: u.username,
      passwordHash: bcrypt.hashSync(u.password, 10),
      role: u.role,
    });
  }
}
