import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubServer } from '../src/app.js';
import { createTestHub } from './helpers.js';

/**
 * Exercises the QNX bridge boundary with a plain TCP client standing in for the
 * native process. (The native C prototype itself is NOT compiled or run here.)
 */
const TOKEN = 'bridge-test-token-0123456789';
let h: HubServer;

beforeEach(async () => {
  h = await createTestHub({ BRIDGE_ENABLED: 'true', BRIDGE_PORT: '0', BRIDGE_TOKEN: TOKEN });
});
afterEach(async () => {
  await h.close();
});

function connect(): Promise<{ sock: net.Socket; lines: string[]; next: () => Promise<Record<string, unknown>> }> {
  return new Promise((resolve) => {
    const port = h.bridge!.address()!.port;
    const sock = net.connect(port, '127.0.0.1', () => {
      const lines: string[] = [];
      const waiters: Array<(l: string) => void> = [];
      let buf = '';
      sock.on('data', (c) => {
        buf += c.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i);
          buf = buf.slice(i + 1);
          const w = waiters.shift();
          if (w) w(l);
          else lines.push(l);
        }
      });
      const next = () =>
        new Promise<Record<string, unknown>>((res) => {
          const l = lines.shift();
          if (l) res(JSON.parse(l));
          else waiters.push((x) => res(JSON.parse(x)));
        });
      resolve({ sock, lines, next });
    });
  });
}

const send = (s: net.Socket, o: unknown) => s.write(JSON.stringify(o) + '\n');
const settle = async () => {
  await new Promise((r) => setTimeout(r, 50));
  await h.hub.engine.idle();
};

describe('BridgeAdapter (NDJSON over TCP)', () => {
  it('rejects a client with the wrong token', async () => {
    const { sock, next } = await connect();
    send(sock, { type: 'hello', token: 'wrong-token-wrong-token' });
    expect(await next()).toEqual({ type: 'error', error: 'unauthorized' });
    sock.destroy();
  });

  it('registers announced devices, ingests validated readings and drives automation', async () => {
    const { sock, next } = await connect();
    send(sock, { type: 'hello', token: TOKEN, node: 'qnx-test', simulated: true });
    expect(await next()).toEqual({ type: 'welcome' });
    send(sock, { type: 'announce', device: { id: 'qnx-co-1', name: 'QNX CO', kind: 'co', room: 'Garage' } });
    send(sock, { type: 'heartbeat', deviceId: 'qnx-co-1' });
    send(sock, { type: 'reading', deviceId: 'qnx-co-1', reading: { metric: 'co_ppm', value: 50 } });
    await settle();

    const d = h.hub.getDevice('qnx-co-1');
    expect(d).toMatchObject({ origin: 'bridge', adapterId: 'bridge', online: true });
    expect(d!.state).toMatchObject({ ppm: 50 });
    expect(h.hub.alerts.list('open').some((a) => a.deviceId === 'qnx-co-1' && a.category === 'co')).toBe(true);
    sock.destroy();
  });

  it('drops malformed frames, implausible readings and spoofed device ids', async () => {
    const { sock, next } = await connect();
    send(sock, { type: 'hello', token: TOKEN });
    await next();
    sock.write('this is not json\n');
    send(sock, { type: 'reading', deviceId: 'co-utility', reading: { metric: 'co_ppm', value: 500 } }); // owned by simulator
    send(sock, { type: 'announce', device: { id: 'qnx-t', name: 'T', kind: 'thermostat', room: 'X' } });
    send(sock, { type: 'reading', deviceId: 'qnx-t', reading: { metric: 'temperature', value: 1000 } });
    await settle();

    expect(h.hub.getDevice('co-utility')!.state).not.toMatchObject({ ppm: 500 });
    expect(h.hub.getDevice('qnx-t')!.health).toBe('fault');
    expect(h.repos.audit.list().filter((e) => e.outcome === 'denied').length).toBeGreaterThanOrEqual(2);
    sock.destroy();
  });

  it('round-trips commands with acknowledgement', async () => {
    const { sock, next } = await connect();
    send(sock, { type: 'hello', token: TOKEN });
    await next();
    send(sock, { type: 'announce', device: { id: 'qnx-light', name: 'QNX Light', kind: 'light', room: 'Lab' } });
    send(sock, { type: 'heartbeat', deviceId: 'qnx-light' });
    await settle();

    const pending = h.hub.executeCommand('qnx-light', { action: 'setPower', on: true }, 'tester');
    const cmd = await next();
    expect(cmd).toMatchObject({ type: 'command', deviceId: 'qnx-light', command: { action: 'setPower', on: true } });
    send(sock, { type: 'ack', id: cmd.id, ok: true });
    const snap = await pending;
    expect(snap.state).toMatchObject({ on: true });
    sock.destroy();
  });
});
