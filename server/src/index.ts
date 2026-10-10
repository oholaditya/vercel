import { loadConfig } from './config/env.js';
import { buildServer } from './app.js';

async function main() {
  const config = loadConfig();
  for (const w of config.warnings) console.warn(`[config] WARNING: ${w}`);

  const hub = await buildServer(config);
  hub.server.listen(config.port, config.host, () => {
    console.log(`[hub] Vertex Home Hub listening on http://${config.host}:${config.port}`);
    console.log(`[hub] simulation: ${config.simulation.enabled ? 'ON (all sensor data is SIMULATED)' : 'off'}`);
    if (config.bridge.enabled) console.log(`[hub] bridge adapter on ${config.bridge.host}:${config.bridge.port}`);
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[hub] ${signal} received, shutting down...`);
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    await hub.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => console.error('[hub] unhandled rejection', err));
  process.on('uncaughtException', (err) => {
    console.error('[hub] uncaught exception', err);
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  console.error('[hub] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
