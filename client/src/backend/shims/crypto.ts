/** Browser stand-in for `node:crypto` (demo build only): the hub engine only needs randomUUID. */
export const randomUUID = (): string => globalThis.crypto.randomUUID();

export default { randomUUID };
