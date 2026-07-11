import { classifyStatus, computePacingDelay } from "./classify";
import { coalesce } from "./coalesce";
import type { DispatchResult, QueuedOp, RequestDescriptor } from "./types";

/**
 * Bound on spaced retries within one flush before an op is set aside. Five
 * attempts (~covering a multi-second transient-error window at ≥1s pacing) is
 * long enough to ride out a blip yet short enough that a flush never spins
 * forever. Only a definite non-retryable 4xx rolls back; a still-retryable
 * (429/5xx/network) op that outlasts the budget is *deferred*: kept durable at
 * the head for the next flush: never dropped, so a persistent outage or rate
 * limit can't silently lose the user's action.
 */
const MAX_ATTEMPTS = 5;

export interface WriteQueueDeps {
  readonly dispatch: (req: RequestDescriptor) => Promise<DispatchResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** Re-read the affected keys; resolve `true` iff Trakt already reflects the op. */
  readonly reconcile: (op: QueuedOp) => Promise<boolean>;
}

interface OpFailure {
  readonly op: QueuedOp;
  readonly inversePatch: unknown;
}

export interface FlushResult {
  readonly completed: QueuedOp[];
  readonly failed: OpFailure[];
}

type Outcome = "done" | "failed" | "defer";

/**
 * Durable FIFO write queue. Paces dispatches ≥1s apart, classifies
 * failures (429/5xx safe-retry honoring `Retry-After`; NetworkError =
 * reconcile-before-retry, never a blind re-POST), coalesces redundant ops, and
 * carries a serializable pending log so it survives persist → reload.
 */
export class WriteQueue {
  private pending: QueuedOp[];
  private lastDispatchAt: number | null = null;
  private readonly deps: WriteQueueDeps;
  /** The op currently being delivered (still the durable head of `pending`). */
  private inFlight: QueuedOp | null = null;
  /** In-progress flush, so concurrent `flush()` calls share one drain pass. */
  private flushing: Promise<FlushResult> | null = null;

  constructor(deps: WriteQueueDeps, initial: readonly QueuedOp[] = []) {
    this.deps = deps;
    this.pending = [...initial];
  }

  get size(): number {
    return this.pending.length;
  }

  /** Serializable copy of the pending log for persistence. */
  snapshot(): QueuedOp[] {
    return this.pending.map((op) => structuredCopy(op));
  }

  /**
   * Coalesce against the *undelivered* tail only. An op already in flight is
   * skipped: its request may still land, so an opposite toggle must enqueue a
   * compensating op behind it: never cancel the in-flight write and lose the
   * user's final intent.
   */
  enqueue(op: QueuedOp): void {
    const head = this.pending[0];
    if (this.inFlight !== null && head === this.inFlight) {
      this.pending = [head, ...coalesce(this.pending.slice(1), op)];
      return;
    }
    this.pending = coalesce(this.pending, op);
  }

  /**
   * Startup pass (before any replay): retire ops that already landed on Trakt
   * pre-crash so a resume never re-applies them (the double-count guard). A
   * reconcile read that fails (offline / 5xx) can't determine landing, so the op
   * is *kept* durable for a later flush: mirroring `deliver`'s reconcile-throw →
   * defer. Startup must never throw: a boot that can't reach Trakt still mounts.
   */
  async startupReconcile(): Promise<void> {
    const kept: QueuedOp[] = [];
    for (const op of this.pending) {
      let applied = false;
      try {
        applied = await this.deps.reconcile(op);
      } catch {
        applied = false; // undetermined → keep durable, retry on the next flush
      }
      if (!applied) kept.push(op);
    }
    this.pending = kept;
  }

  /** Single-flight: concurrent callers share the running drain, never double-dispatch the head. */
  flush(): Promise<FlushResult> {
    if (this.flushing !== null) return this.flushing;
    const run = this.drain().finally(() => {
      this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  private async drain(): Promise<FlushResult> {
    const completed: QueuedOp[] = [];
    const failed: OpFailure[] = [];
    while (this.pending.length > 0) {
      const op = this.pending[0];
      if (op === undefined) break;
      this.inFlight = op;
      const outcome = await this.deliver(op);
      this.inFlight = null;
      if (outcome === "defer") break; // keep op at head; retry on next flush
      this.pending.shift();
      if (outcome === "done") completed.push(op);
      else failed.push({ op, inversePatch: op.inversePatch });
    }
    return { completed, failed };
  }

  private async deliver(op: QueuedOp): Promise<Outcome> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await this.pace();
      let result: DispatchResult;
      try {
        result = await this.deps.dispatch(op.request);
      } catch {
        let applied: boolean;
        try {
          applied = await this.deps.reconcile(op);
        } catch {
          return "defer"; // can't determine → keep durable for the next flush
        }
        if (applied) return "done";
        continue; // reconciled (never a blind re-POST); retry within budget
      }
      const classification = classifyStatus(result, attempt, this.deps.now());
      if (classification.kind === "ok") return "done";
      if (classification.kind === "failed") return "failed";
      if (attempt + 1 >= MAX_ATTEMPTS) break; // budget spent; don't sleep only to defer
      await this.deps.sleep(classification.delayMs);
    }
    return "defer"; // still-retryable after the budget → durable, never dropped
  }

  private async pace(): Promise<void> {
    const wait = computePacingDelay(this.deps.now(), this.lastDispatchAt);
    if (wait > 0) await this.deps.sleep(wait);
    this.lastDispatchAt = this.deps.now();
  }
}

function structuredCopy(op: QueuedOp): QueuedOp {
  return JSON.parse(JSON.stringify(op)) as QueuedOp;
}
