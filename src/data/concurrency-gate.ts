/**
 * Admit at most `limit` reads at a time, handing a released slot straight to the
 * longest-waiting caller.
 *
 * Distinct from a batch map over a known array: callers arrive one at a time (a row
 * scrolling into view) and may drop out before they are ever admitted, so a waiter
 * whose `signal` aborts rejects and leaves the queue without having taken a slot.
 * Aborting an already-admitted read is not the gate's business: its slot frees when
 * the read settles, exactly as any other.
 */
export function createConcurrencyGate(
  limit: number,
): <T>(read: () => Promise<T>, signal?: AbortSignal) => Promise<T> {
  let active = 0;
  let waiters: Array<() => void> = [];

  const acquire = (signal: AbortSignal | undefined): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason);
        return;
      }
      if (active < limit) {
        active += 1;
        resolve();
        return;
      }
      if (signal === undefined) {
        waiters.push(resolve);
        return;
      }
      const onAbort = (): void => {
        waiters = waiters.filter((waiter) => waiter !== admit);
        reject(signal.reason);
      };
      const admit = (): void => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      waiters.push(admit);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  return async function run<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal);
    try {
      return await read();
    } finally {
      const next = waiters.shift();
      if (next === undefined) active -= 1;
      else next();
    }
  };
}
