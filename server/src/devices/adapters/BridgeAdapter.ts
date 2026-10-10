import crypto from 'node:crypto';
import net from 'node:net';
import { z } from 'zod';
import type { DeviceCommand, DeviceSnapshot } from '../../domain/types.js';
import { ID } from '../../domain/schemas.js';
import { DeviceUnreachableError, type AdapterSink, type DeviceAdapter } from './DeviceAdapter.js';

/**
 * QNX integration boundary: newline-delimited JSON over TCP.
 *
 * A native process (see native/qnx/) connects, authenticates with a shared token,
 * announces its devices and streams readings / heartbeats. The hub sends commands
 * back on the same socket. Every frame is size-limited and schema-validated;
 * anything malformed is dropped and reported as a diagnostic.
 *
 * Protocol (one JSON object per line, max 4 KiB):
 *   -> {"type":"hello","token":"...","node":"qnx-node-1","simulated":false}
 *   <- {"type":"welcome"}
 *   -> {"type":"announce","device":{"id":"..","name":"..","kind":"co","room":".."}}
 *   -> {"type":"reading","deviceId":"..","reading":{"metric":"co_ppm","value":4}}
 *   -> {"type":"heartbeat","deviceId":".."}
 *   <- {"type":"command","id":"..","deviceId":"..","command":{...}}
 *   -> {"type":"ack","id":"..","ok":true}
 */

const MAX_FRAME = 4096;
const COMMAND_TIMEOUT_MS = 3000;

const Frame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().max(256), node: z.string().max(64).default('bridge'), simulated: z.boolean().default(false) }),
  z.object({
    type: z.literal('announce'),
    device: z.object({
      id: ID,
      name: z.string().min(1).max(60),
      kind: z.enum(['light', 'thermostat', 'smoke', 'co', 'contact', 'motion', 'security_panel']),
      room: z.string().min(1).max(40),
    }),
  }),
  z.object({ type: z.literal('reading'), deviceId: ID, reading: z.unknown() }),
  z.object({ type: z.literal('heartbeat'), deviceId: ID }),
  z.object({ type: z.literal('ack'), id: z.string().max(64), ok: z.boolean(), error: z.string().max(200).optional() }),
]);

interface Session {
  socket: net.Socket;
  authed: boolean;
  node: string;
  simulated: boolean;
  devices: Set<string>;
}

export class BridgeAdapter implements DeviceAdapter {
  readonly id = 'bridge';
  readonly origin = 'bridge' as const;
  private server: net.Server | null = null;
  private sink: AdapterSink | null = null;
  private readonly sessions = new Set<Session>();
  private readonly pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly opts: { host: string; port: number; token: string }) {}

  async start(sink: AdapterSink): Promise<void> {
    this.sink = sink;
    this.server = net.createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.opts.port, this.opts.host, () => resolve());
    });
    sink.diagnostic(`Bridge listening on ${this.opts.host}:${this.address()?.port}`, 'info');
  }

  address(): net.AddressInfo | null {
    const a = this.server?.address();
    return a && typeof a === 'object' ? a : null;
  }

  async stop(): Promise<void> {
    for (const s of this.sessions) s.socket.destroy();
    this.sessions.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  status() {
    const authed = [...this.sessions].filter((s) => s.authed);
    return { connected: authed.length > 0, detail: `${authed.length} bridge session(s)` };
  }

  async sendCommand(device: DeviceSnapshot, command: DeviceCommand): Promise<void> {
    const session = [...this.sessions].find((s) => s.authed && s.devices.has(device.id));
    if (!session) throw new DeviceUnreachableError(device.id);
    const id = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DeviceUnreachableError(device.id));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      session.socket.write(JSON.stringify({ type: 'command', id, deviceId: device.id, command }) + '\n');
    });
  }

  private accept(socket: net.Socket) {
    const session: Session = { socket, authed: false, node: 'unknown', simulated: false, devices: new Set() };
    this.sessions.add(session);
    socket.setEncoding('utf8');
    let buffer = '';
    const authTimer = setTimeout(() => !session.authed && socket.destroy(), 5000);

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_FRAME * 4) {
        this.sink?.diagnostic(`Bridge ${session.node}: buffer overflow, closing`, 'warn');
        socket.destroy();
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.handleLine(session, line);
      }
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.sessions.delete(session);
    });
    socket.on('error', () => socket.destroy());
  }

  private handleLine(session: Session, line: string) {
    const sink = this.sink!;
    if (line.length > MAX_FRAME) {
      sink.diagnostic(`Bridge ${session.node}: oversized frame dropped`, 'warn');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      sink.diagnostic(`Bridge ${session.node}: malformed JSON dropped`, 'warn');
      return;
    }
    const parsed = Frame.safeParse(json);
    if (!parsed.success) {
      sink.diagnostic(`Bridge ${session.node}: invalid frame dropped`, 'warn');
      return;
    }
    const f = parsed.data;

    if (!session.authed) {
      if (f.type !== 'hello' || !safeEqual(f.token, this.opts.token)) {
        sink.diagnostic('Bridge authentication failed', 'warn');
        session.socket.end(JSON.stringify({ type: 'error', error: 'unauthorized' }) + '\n');
        return;
      }
      session.authed = true;
      session.node = f.node;
      session.simulated = f.simulated;
      session.socket.write(JSON.stringify({ type: 'welcome' }) + '\n');
      sink.diagnostic(`Bridge node "${f.node}" connected${f.simulated ? ' (declares SIMULATED data)' : ''}`, 'info');
      return;
    }

    switch (f.type) {
      case 'announce':
        session.devices.add(f.device.id);
        sink.announce?.(f.device, { simulated: session.simulated });
        break;
      case 'reading':
        if (!session.devices.has(f.deviceId)) {
          sink.diagnostic(`Bridge ${session.node}: reading for unannounced device ${f.deviceId} dropped`, 'warn');
          return;
        }
        sink.reading(f.deviceId, f.reading, { simulated: session.simulated });
        break;
      case 'heartbeat':
        if (session.devices.has(f.deviceId)) sink.heartbeat(f.deviceId);
        break;
      case 'ack': {
        const p = this.pending.get(f.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(f.id);
        f.ok ? p.resolve() : p.reject(new Error(f.error ?? 'Bridge rejected command'));
        break;
      }
      case 'hello':
        break;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
