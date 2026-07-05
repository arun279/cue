/**
 * Transport-agnostic write-queue types. An op is a plain, JSON-serializable
 * envelope (no closures) so the pending log survives persist → reload; the
 * actual `fetch` that turns a `RequestDescriptor` into a `DispatchResult` lives
 * in the data layer, injected into the queue.
 */

export interface RequestDescriptor {
  readonly method: "POST";
  readonly path: string;
  readonly body: unknown;
}

export interface DispatchResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: unknown;
}

export interface QueuedOp {
  /** Stable client op-id; a retry re-sends the identical op. */
  readonly id: string;
  /** Coalescing key — redundant ops on the same key collapse. */
  readonly itemKey: string;
  readonly request: RequestDescriptor;
  /** Compensating request for undo (`remove` inverts an add, and vice versa). */
  readonly inverse: RequestDescriptor;
  /** Opaque cache patch the UI applies to roll back a hard failure. */
  readonly inversePatch: unknown;
  /** `watched_at` frozen at enqueue so a retry is byte-identical. */
  readonly watchedAt: string | null;
  readonly fromState: "present" | "absent";
  readonly toState: "present" | "absent";
  /** Keys to re-read when reconciling an ambiguous (network) failure. */
  readonly reconcileKeys: readonly string[];
}
