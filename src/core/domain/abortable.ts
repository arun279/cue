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

/** Runs `request` with a signal that aborts after `ms`, or as soon as `scope` aborts. */
export async function withDeadline<T>(
  ms: number,
  scope: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, ms);
  if (scope?.aborted) abort();
  else scope?.addEventListener("abort", abort);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
    scope?.removeEventListener("abort", abort);
  }
}
