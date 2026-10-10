import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { openDatabase, type Db } from './db/database.js';
import { createRepositories, type Repositories } from './db/repositories.js';
import { seedDatabase } from './db/seed.js';
import { AuthService } from './auth/auth.js';
import { Hub } from './engine/Hub.js';
import { SimulatedAdapter } from './devices/adapters/SimulatedAdapter.js';
import { BridgeAdapter } from './devices/adapters/BridgeAdapter.js';
import { createApiRouter } from './api/routes.js';
import { errorHandler } from './api/middleware/errors.js';
import { attachRealtime } from './realtime/socket.js';

export interface BuildOptions {
  /** Drive the simulator manually (tests). */
  manualSimulation?: boolean;
  loginRateLimit?: number;
  /** Serve the built client from this directory if it exists. */
  staticDir?: string;
}

export interface HubServer {
  app: express.Express;
  server: http.Server;
  hub: Hub;
  repos: Repositories;
  db: Db;
  simulator: SimulatedAdapter | null;
  bridge: BridgeAdapter | null;
  close(): Promise<void>;
}

/** Composition root: storage -> devices/adapters -> engine -> API -> realtime. */
export async function buildServer(config: AppConfig, opts: BuildOptions = {}): Promise<HubServer> {
  const db = openDatabase(config.databasePath);
  const repos = createRepositories(db);
  seedDatabase(repos, config);

  const hub = new Hub({ repos, heartbeatTimeoutMs: config.heartbeatTimeoutMs, readingPersistEvery: 1 });

  let simulator: SimulatedAdapter | null = null;
  if (config.simulation.enabled) {
    simulator = new SimulatedAdapter({ tickMs: config.simulation.tickMs, autoTick: !opts.manualSimulation });
    simulator.register(hub.listDevices());
    hub.simulator = simulator;
    await hub.addAdapter(simulator);
  }

  let bridge: BridgeAdapter | null = null;
  if (config.bridge.enabled) {
    bridge = new BridgeAdapter({ host: config.bridge.host, port: config.bridge.port, token: config.bridge.token });
    await hub.addAdapter(bridge);
  }

  const auth = new AuthService(repos.users, { jwtSecret: config.jwtSecret, jwtExpiresIn: config.jwtExpiresIn });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', createApiRouter({ hub, repos, auth, loginRateLimit: opts.loginRateLimit }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const staticDir = opts.staticDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use(
    errorHandler((err, req) => {
      console.error('[api] unhandled error', req.method, req.path, err);
      repos.audit.log(req.user?.username ?? 'anonymous', `${req.method} ${req.path}`, 'failed', String((err as Error)?.message ?? err));
    }),
  );

  const server = http.createServer(app);
  const realtime = attachRealtime(server, hub, auth, config.corsOrigins);
  hub.start();

  return {
    app, server, hub, repos, db, simulator, bridge,
    async close() {
      await realtime.close();
      await hub.stop();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
