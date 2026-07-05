import type { TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import type { QueuedOp } from "@domain/write-queue/types";
import { createContext, useContext } from "react";

/** The read side of the home surface: the assembled queue + the image resolver config. */
export interface UpNextData {
  readonly entries: readonly LibraryEntry[];
  readonly tmdbConfig: TmdbImageConfig | null;
}

/** How a submitted write settled: applied, definitively rejected, or still durable-pending. */
export type SubmitOutcome = "done" | "failed" | "deferred";

/**
 * The composition-root services the UI runs on, injected so `@ui` stays free of
 * `@app`/`@platform` (dependency-cruiser). `loadUpNext` is the persisted-SWR
 * read; `submit` enqueues a write onto the durable queue, persists the op-log,
 * flushes (paced, 429/network aware), and reports how the head op settled.
 */
export interface CueRuntime {
  loadUpNext(): Promise<UpNextData>;
  submit(op: QueuedOp): Promise<SubmitOutcome>;
}

const RuntimeContext = createContext<CueRuntime | null>(null);

export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): CueRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) throw new Error("useRuntime must be used within a RuntimeProvider.");
  return runtime;
}
