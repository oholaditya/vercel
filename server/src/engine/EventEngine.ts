import crypto from 'node:crypto';
import type { EngineStats, EventPriority, HubEvent } from '../domain/types.js';

export const PRIORITY_ORDER: readonly EventPriority[] = ['critical', 'high', 'normal', 'low'];

export type EventInput = Omit<HubEvent, 'id' | 'ts'> & { ts?: string };
export type EventHandler = (event: HubEvent) => void | Promise<void>;

interface Queued {
  event: HubEvent;
  enqueuedAt: number;
}

/**
 * Asynchronous, priority-ordered event dispatcher (the "coordination engine" core).
 *
 * Events are placed in one FIFO per priority. The drain loop always takes from the
 * highest non-empty priority, so a critical smoke event overtakes queued telemetry.
 *
 * IMPORTANT: this runs on the Node.js event loop. Ordering is guaranteed, but timing
 * is NOT deterministic - GC pauses, I/O and OS scheduling add unbounded jitter.
 * See docs/QNX_INTEGRATION.md for how the same design maps onto QNX Neutrino
 * pulses and priority-inherited message passing for bounded latency.
 */
export class EventEngine {
  private readonly queues: Record<EventPriority, Queued[]> = { critical: [], high: [], normal: [], low: [] };
  private readonly handlers: EventHandler[] = [];
  private draining = false;
  private scheduled = false;
  private idleWaiters: Array<() => void> = [];
  private stats = {
    processed: 0,
    dropped: 0,
    totalLatency: 0,
    maxLatency: 0,
    byPriority: { critical: 0, high: 0, normal: 0, low: 0 } as Record<EventPriority, number>,
  };

  constructor(private readonly opts: { maxQueue: number; batchSize: number } = { maxQueue: 10_000, batchSize: 64 }) {}

  subscribe(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  publish(input: EventInput): HubEvent {
    const event: HubEvent = { ...input, id: crypto.randomUUID(), ts: input.ts ?? new Date().toISOString() };
    if (this.depth() >= this.opts.maxQueue && !this.shedLowest(event.priority)) {
      this.stats.dropped++;
      return event;
    }
    this.queues[event.priority].push({ event, enqueuedAt: performance.now() });
    this.schedule();
    return event;
  }

  depth(): number {
    return PRIORITY_ORDER.reduce((n, p) => n + this.queues[p].length, 0);
  }

  /** Resolves once every queued event (and events they cause) has been handled. */
  async idle(): Promise<void> {
    if (this.depth() === 0 && !this.draining && !this.scheduled) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  getStats(): EngineStats {
    return {
      queueDepth: this.depth(),
      processed: this.stats.processed,
      dropped: this.stats.dropped,
      avgLatencyMs: this.stats.processed ? round(this.stats.totalLatency / this.stats.processed) : 0,
      maxLatencyMs: round(this.stats.maxLatency),
      byPriority: { ...this.stats.byPriority },
    };
  }

  /** Under overload, discard the oldest lower-priority event to make room. */
  private shedLowest(incoming: EventPriority): boolean {
    for (let i = PRIORITY_ORDER.length - 1; i > PRIORITY_ORDER.indexOf(incoming); i--) {
      const q = this.queues[PRIORITY_ORDER[i]!];
      if (q.length) {
        q.shift();
        this.stats.dropped++;
        return true;
      }
    }
    return false;
  }

  private next(): Queued | undefined {
    for (const p of PRIORITY_ORDER) {
      const q = this.queues[p];
      if (q.length) return q.shift();
    }
    return undefined;
  }

  private schedule() {
    if (this.scheduled || this.draining) return;
    this.scheduled = true;
    setImmediate(() => void this.drain());
  }

  private async drain() {
    this.scheduled = false;
    this.draining = true;
    try {
      let n = 0;
      let item: Queued | undefined;
      while (n < this.opts.batchSize && (item = this.next())) {
        n++;
        const latency = performance.now() - item.enqueuedAt;
        this.stats.processed++;
        this.stats.totalLatency += latency;
        this.stats.maxLatency = Math.max(this.stats.maxLatency, latency);
        this.stats.byPriority[item.event.priority]++;
        for (const h of [...this.handlers]) {
          try {
            await h(item.event);
          } catch (err) {
            console.error('[engine] handler failed for', item.event.type, err);
          }
        }
      }
    } finally {
      this.draining = false;
    }
    if (this.depth() > 0) this.schedule();
    else {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
