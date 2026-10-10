#!/usr/bin/env node
// Creates server/.env from server/.env.example with freshly generated secrets.
// Safe to re-run: an existing server/.env is never overwritten.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'server', '.env.example');
const target = path.join(root, 'server', '.env');

if (fs.existsSync(target)) {
  console.log('server/.env already exists - leaving it untouched.');
  process.exit(0);
}

const pw = () => crypto.randomBytes(12).toString('base64url');
const creds = { admin: pw(), operator: pw(), viewer: pw() };

const content = fs
  .readFileSync(example, 'utf8')
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`)
  .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${creds.admin}`)
  .replace(/^OPERATOR_PASSWORD=.*$/m, `OPERATOR_PASSWORD=${creds.operator}`)
  .replace(/^VIEWER_PASSWORD=.*$/m, `VIEWER_PASSWORD=${creds.viewer}`)
  .replace(/^BRIDGE_TOKEN=.*$/m, `BRIDGE_TOKEN=${crypto.randomBytes(24).toString('hex')}`);

fs.writeFileSync(target, content, { mode: 0o600 });
console.log('Created server/.env with generated secrets.\n');
console.log('Sign-in credentials (also stored in server/.env):');
for (const [user, pass] of Object.entries(creds)) console.log(`  ${user.padEnd(9)} ${pass}`);
console.log('\nChange them any time by editing server/.env and restarting the server.');
