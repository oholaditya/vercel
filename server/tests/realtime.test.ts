import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubServer } from '../src/app.js';
import type { DeviceSnapshot, HubEvent } from '../src/domain/types.js';
import { createTestHub, login } from './helpers.js';

let h: HubServer;
let url: string;

beforeAll(async () => {
  h = await createTestHub();
  await new Promise<void>((r) => h.server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(h.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await h.close();
});

const open = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => {
      s.close();
      reject(e);
    });
  });

describe('Realtime (Socket.IO)', () => {
  it('rejects connections without a valid token', async () => {
    await expect(open('nope')).rejects.toThrow(/unauthorized/);
  });

  it('pushes device updates and events after a command', async () => {
    const token = await login(h, 'operator');
    const s = await open(token);
    const update = new Promise<DeviceSnapshot>((r) => s.on('device:update', (d) => d.id === 'light-bedroom' && r(d)));
    const event = new Promise<HubEvent>((r) => s.on('event:new', (e) => e.type === 'device.command' && r(e)));
    await h.hub.executeCommand('light-bedroom', { action: 'setPower', on: true }, 'operator');
    expect((await update).state).toMatchObject({ on: true });
    expect((await event).message).toContain('Bedroom Lamp');
    s.close();
  });
});
