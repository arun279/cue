/** Resolves after `ms`, or as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    if (signal?.aborted) wake();
    else signal?.addEventListener("abort", wake);
  });
}

class AbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}

/**
 * Runs `request` with a signal that aborts after `ms`, or as soon as `scope` aborts. A scope
 * that has ended neither starts a request nor takes its answer: React Native's fetch can
 * still resolve a response that completed just before the abort.
 */
export async function withDeadline<T>(
  ms: number,
  scope: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (scope?.aborted) throw new AbortError();
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, ms);
  scope?.addEventListener("abort", abort);
  try {
    const answer = await request(controller.signal);
    if (scope?.aborted) throw new AbortError();
    return answer;
  } finally {
    clearTimeout(timer);
    scope?.removeEventListener("abort", abort);
  }
}
