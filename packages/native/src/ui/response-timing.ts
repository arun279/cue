import { useSyncExternalStore } from "react";

type Action = "mark" | "undo";

const SAMPLE_WINDOW = 15;

const samples: Record<Action, number[]> = { mark: [], undo: [] };
const listeners = new Set<() => void>();
let pending: Action | null = null;

const markName = (action: Action, edge: "start" | "visible") => `cue-${action}-${edge}`;
const list = (values: readonly number[]) => values.map((value) => value.toFixed(1)).join(",");

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
  samples[action] = [...samples[action].slice(1 - SAMPLE_WINDOW), duration];
  pending = null;
  for (const listener of listeners) listener();
}

function snapshot(): string | null {
  if (samples.mark.length === 0 || samples.undo.length === 0) return null;
  return `Response timing: mark ${list(samples.mark)}; undo ${list(samples.undo)}`;
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
