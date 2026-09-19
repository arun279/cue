import { useSyncExternalStore } from "react";

type Action = "mark" | "undo";

const samples: Record<Action, number[]> = { mark: [], undo: [] };
const listeners = new Set<() => void>();
let pending: Action | null = null;

const markName = (action: Action, edge: "start" | "visible") => `cue-${action}-${edge}`;
function median(values: readonly number[]): number {
  const middle = [...values].sort((a, b) => a - b)[2];
  if (middle === undefined) throw new TypeError("five timing samples are required");
  return middle;
}

export function beginResponseTiming(action: Action): void {
  if (typeof performance.mark !== "function") return;
  pending = action;
  performance.mark(markName(action, "start"));
}

export function commitResponseTiming(): void {
  const action = pending;
  if (action === null || typeof performance.measure !== "function") return;
  const start = markName(action, "start");
  const visible = markName(action, "visible");
  performance.mark(visible);
  const measurement = performance.measure(`cue-${action}-feedback`, start, visible) as
    | PerformanceMeasure
    | undefined;
  if (measurement === undefined) {
    pending = null;
    return;
  }
  const { duration } = measurement;
  performance.clearMarks(start);
  performance.clearMarks(visible);
  performance.clearMeasures(`cue-${action}-feedback`);
  samples[action] = [...samples[action].slice(-4), duration];
  pending = null;
  for (const listener of listeners) listener();
}

function snapshot(): string | null {
  if (samples.mark.length < 5 || samples.undo.length < 5) return null;
  return `Response timing: mark ${median(samples.mark).toFixed(1)} ms, undo ${median(samples.undo).toFixed(1)} ms`;
}

export function useResponseTiming(): string | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, snapshot);
}

export function resetResponseTiming(): void {
  samples.mark = [];
  samples.undo = [];
  pending = null;
}
