import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { PublicUser, ServerToClientEvents } from '../domain/types.js';
import type { AuthService } from '../auth/auth.js';
import type { Hub } from '../engine/Hub.js';

interface SocketData {
  user: PublicUser;
}

/**
 * Real-time fan-out. Clients authenticate with the same JWT as the REST API
 * (handshake `auth.token`). The socket is server -> client only: every state
 * change goes through the validated REST command path.
 */
export function attachRealtime(http: HttpServer, hub: Hub, auth: AuthService, corsOrigins: string[]) {
  const io = new Server<Record<string, never>, ServerToClientEvents, Record<string, never>, SocketData>(http, {
    cors: { origin: corsOrigins, credentials: false },
    maxHttpBufferSize: 16 * 1024,
  });

  io.use((socket, next) => {
    const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
    const user = auth.verify(token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    socket.emit('system:overview', hub.overview());
  });

  hub.on('device', (d) => io.emit('device:update', d));
  hub.on('event', (e) => io.emit('event:new', e));
  hub.on('alert', (a) => io.emit('alert:upsert', a));
  hub.on('rule', (r) => io.emit('rule:upsert', r));
  hub.on('ruleDeleted', (id) => io.emit('rule:delete', id));
  hub.on('telemetry', (t) => io.volatile.emit('telemetry:point', t));

  const ticker = setInterval(() => io.emit('system:overview', hub.overview()), 2000);
  ticker.unref?.();

  return {
    io,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(ticker);
        io.close(() => resolve());
      }),
  };
}
