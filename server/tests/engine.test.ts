import { describe, expect, it } from 'vitest';
import { EventEngine } from '../src/engine/EventEngine.js';
import type { EventPriority } from '../src/domain/types.js';

const ev = (priority: EventPriority, message: string) => ({
  type: 'system' as const, priority, source: 'system' as const, deviceId: null, message, simulated: true,
});

describe('EventEngine', () => {
  it('processes queued events strictly by priority, FIFO within a priority', async () => {
    const engine = new EventEngine();
    const seen: string[] = [];
    engine.subscribe((e) => {
      seen.push(e.message);
    });
    engine.publish(ev('low', 'low-1'));
    engine.publish(ev('normal', 'normal-1'));
    engine.publish(ev('critical', 'critical-1'));
    engine.publish(ev('high', 'high-1'));
    engine.publish(ev('critical', 'critical-2'));
    await engine.idle();
    expect(seen).toEqual(['critical-1', 'critical-2', 'high-1', 'normal-1', 'low-1']);
    expect(engine.getStats()).toMatchObject({ processed: 5, queueDepth: 0, dropped: 0 });
  });

  it('sheds lower-priority work under overload but keeps critical events', async () => {
    const engine = new EventEngine({ maxQueue: 3, batchSize: 64 });
    const seen: string[] = [];
    engine.subscribe((e) => {
      seen.push(e.message);
    });
    engine.publish(ev('low', 'l1'));
    engine.publish(ev('low', 'l2'));
    engine.publish(ev('low', 'l3'));
    engine.publish(ev('critical', 'c1')); // evicts l1
    engine.publish(ev('low', 'l4')); // queue full of >= low → dropped
    await engine.idle();
    expect(seen).toEqual(['c1', 'l2', 'l3']);
    expect(engine.getStats().dropped).toBe(2);
  });

  it('a failing handler does not stop other handlers', async () => {
    const engine = new EventEngine();
    let reached = 0;
    engine.subscribe(() => {
      throw new Error('boom');
    });
    engine.subscribe(() => {
      reached++;
    });
    const orig = console.error;
    console.error = () => {};
    engine.publish(ev('normal', 'x'));
    await engine.idle();
    console.error = orig;
    expect(reached).toBe(1);
  });
});
