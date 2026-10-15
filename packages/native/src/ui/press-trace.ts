import { useEffect, useSyncExternalStore } from "react";

interface Timed {
  readonly nativeEvent: { readonly timestamp: number };
}

const listeners = new Set<() => void>();
let trace: string | null = null;
let shownAt = 0;
let firstTouchAt: number | null = null;

function publish(next: string): void {
  trace = next;
  for (const listener of listeners) listener();
}

export function tracePress(event: string, timed?: Timed): void {
  let entry = `${event} +${Math.round(performance.now() - shownAt)} ms`;
  if (timed !== undefined) {
    firstTouchAt ??= timed.nativeEvent.timestamp;
    entry += ` native +${Math.round(timed.nativeEvent.timestamp - firstTouchAt)} ms`;
  }
  publish(`${trace}; ${entry}`);
}

export function usePressTrace(): string | null {
  useEffect(() => {
    shownAt = performance.now();
    firstTouchAt = null;
    publish("shown");
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => trace,
  );
}
