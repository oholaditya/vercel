/**
 * Minimal browser stand-in for `node:events` (demo build only, via Vite alias).
 * Implements the subset the hub engine uses: on / off / once / emit.
 */
type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private readonly listeners = new Map<string | symbol, Listener[]>();

  on(event: string | symbol, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener);
  }

  off(event: string | symbol, listener: Listener): this {
    const list = this.listeners.get(event);
    if (list) this.listeners.set(event, list.filter((l) => l !== listener));
    return this;
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener);
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.listeners.get(event);
    if (!list?.length) return false;
    for (const l of [...list]) l(...args);
    return true;
  }
}

export default { EventEmitter };
