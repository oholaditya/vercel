import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA_VERSION = 1;

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  room        TEXT NOT NULL,
  adapter_id  TEXT NOT NULL,
  origin      TEXT NOT NULL,
  state_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,
  trigger_json   TEXT NOT NULL,
  actions_json   TEXT NOT NULL,
  cooldown_ms    INTEGER NOT NULL DEFAULT 30000,
  last_fired_at  TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  priority   TEXT NOT NULL,
  source     TEXT NOT NULL,
  device_id  TEXT,
  message    TEXT NOT NULL,
  simulated  INTEGER NOT NULL,
  data_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id               TEXT PRIMARY KEY,
  ts               TEXT NOT NULL,
  severity         TEXT NOT NULL,
  category         TEXT NOT NULL,
  title            TEXT NOT NULL,
  message          TEXT NOT NULL,
  device_id        TEXT,
  rule_id          TEXT,
  status           TEXT NOT NULL,
  acknowledged_by  TEXT,
  acknowledged_at  TEXT,
  resolved_at      TEXT,
  simulated        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status, ts DESC);

CREATE TABLE IF NOT EXISTS readings (
  device_id  TEXT NOT NULL,
  metric     TEXT NOT NULL,
  ts         TEXT NOT NULL,
  value      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings ON readings (device_id, metric, ts DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  outcome  TEXT NOT NULL CHECK (outcome IN ('success','denied','failed')),
  ip       TEXT,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

/** Opens (and migrates) the SQLite database. Use ':memory:' for tests. */
export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  if (current < 1) {
    transaction(db, () => db.exec(MIGRATION_V1));
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
