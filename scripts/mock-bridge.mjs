#!/usr/bin/env node
/**
 * Mock bridge client - stands in for native/qnx/hubd_bridge.c so the NDJSON/TCP
 * integration boundary can be exercised on any machine (no QNX required).
 *
 * Every frame it sends is declared "simulated": true in the hello handshake,
 * so the hub labels the resulting devices and events as SIMULATED.
 *
 * Usage:
 *   BRIDGE_TOKEN=... node scripts/mock-bridge.mjs [host] [port]
 */
import net from 'node:net';

const host = process.argv[2] ?? '127.0.0.1';
const port = Number(process.argv[3] ?? 7400);
const token = process.env.BRIDGE_TOKEN;
if (!token) {
  console.error('Set BRIDGE_TOKEN (same value as in server/.env).');
  process.exit(2);
}

const devices = [
  { id: 'qnx-smoke-1', name: 'QNX Kitchen Smoke', kind: 'smoke', room: 'Kitchen', metric: 'obscuration', value: 0.4, base: 0.4 },
  { id: 'qnx-co-1', name: 'QNX Garage CO', kind: 'co', room: 'Garage', metric: 'co_ppm', value: 3, base: 3 },
  { id: 'qnx-light-1', name: 'QNX Garage Light', kind: 'light', room: 'Garage' },
];

const sock = net.connect(port, host, () => {
  const send = (o) => sock.write(JSON.stringify(o) + '\n');
  send({ type: 'hello', token, node: 'mock-qnx-node', simulated: true });
  for (const d of devices) send({ type: 'announce', device: { id: d.id, name: d.name, kind: d.kind, room: d.room } });

  let tick = 0;
  setInterval(() => {
    tick++;
    for (const d of devices) {
      send({ type: 'heartbeat', deviceId: d.id });
      if (!d.metric) continue;
      d.value = Math.max(0, d.value + (d.base - d.value) * 0.2 + (Math.random() - 0.5) * (d.kind === 'smoke' ? 0.1 : 0.8));
      send({ type: 'reading', deviceId: d.id, reading: { metric: d.metric, value: Math.round(d.value * 100) / 100 } });
    }
    if (tick % 30 === 0) console.log(`[mock-bridge] ${tick} ticks sent`);
  }, 1000);

  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      if (msg.type === 'welcome') console.log('[mock-bridge] authenticated with hub');
      else if (msg.type === 'error') {
        console.error('[mock-bridge] hub error:', msg.error);
        process.exit(1);
      } else if (msg.type === 'command') {
        console.log('[mock-bridge] command', msg.deviceId, JSON.stringify(msg.command));
        send({ type: 'ack', id: msg.id, ok: true });
      }
    }
  });
});

sock.on('error', (e) => {
  console.error('[mock-bridge] connection error:', e.message);
  process.exit(1);
});
sock.on('close', () => {
  console.log('[mock-bridge] disconnected');
  process.exit(0);
});
