import { classifyStatus, computePacingDelay } from "./classify";
import { coalesce } from "./coalesce";
import type { DispatchResult, QueuedOp, RequestDescriptor } from "./types";

const MAX_ATTEMPTS_PER_FLUSH = 5;

export interface WriteQueueDeps {
  readonly dispatch: (req: RequestDescriptor) => Promise<DispatchResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly reconcile: (op: QueuedOp) => Promise<boolean>;
  readonly accept?: (op: QueuedOp, result: DispatchResult) => boolean;
}

interface OpFailure {
  readonly op: QueuedOp;
  readonly inversePatch: unknown;
}

export interface FlushResult {
  readonly completed: QueuedOp[];
  readonly failed: OpFailure[];
  readonly delivered: ReadonlyMap<string, DispatchResult>;
}

type Outcome = "done" | "failed" | "defer";

interface Delivery {
  readonly outcome: Outcome;
  readonly result?: DispatchResult;
}

export class WriteQueue {
  private pending: QueuedOp[];
  private lastDispatchAt: number | null = null;
  private readonly deps: WriteQueueDeps;
  private inFlight: QueuedOp | null = null;
  private flushing: Promise<FlushResult> | null = null;

  constructor(deps: WriteQueueDeps, initial: readonly QueuedOp[] = []) {
    this.deps = deps;
    this.pending = [...initial];
  }

  get size(): number {
    return this.pending.length;
  }

  get inFlightId(): string | null {
    return this.inFlight?.id ?? null;
  }

  snapshot(): QueuedOp[] {
    return this.pending.map((op) => structuredCopy(op));
  }

  enqueue(op: QueuedOp): void {
    const head = this.pending[0];
    if (this.inFlight !== null && head === this.inFlight) {
      this.pending = [head, ...coalesce(this.pending.slice(1), op)];
      return;
    }
    this.pending = coalesce(this.pending, op);
  }

  async startupReconcile(): Promise<void> {
    const kept: QueuedOp[] = [];
    for (const op of this.pending) {
      let applied = false;
      try {
        applied = await this.deps.reconcile(op);
      } catch {
        applied = false;
      }
      if (!applied) kept.push(op);
    }
    this.pending = kept;
  }

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
    const delivered = new Map<string, DispatchResult>();
    for (let op = this.pending[0]; op !== undefined; op = this.pending[0]) {
      this.inFlight = op;
      const { outcome, result } = await this.deliver(op);
      this.inFlight = null;
      if (outcome === "defer") break;
      this.pending.shift();
      if (outcome === "done") {
        completed.push(op);
        if (result !== undefined) delivered.set(op.id, result);
      } else failed.push({ op, inversePatch: op.inversePatch });
    }
    return { completed, failed, delivered };
  }

  private async accepted(op: QueuedOp, result: DispatchResult): Promise<Delivery> {
    if (this.deps.accept?.(op, result) === false) return { outcome: await this.reconciled(op) };
    return { outcome: "done", result };
  }

  private async reconciled(op: QueuedOp): Promise<Outcome> {
    try {
      return (await this.deps.reconcile(op)) ? "done" : "failed";
    } catch {
      return "failed";
    }
  }

  private async deliver(op: QueuedOp): Promise<Delivery> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_FLUSH; attempt += 1) {
      await this.pace();
      let result: DispatchResult;
      try {
        result = await this.deps.dispatch(op.request);
      } catch {
        let applied: boolean;
        try {
          applied = await this.deps.reconcile(op);
        } catch {
          return { outcome: "defer" };
        }
        if (applied) return { outcome: "done" };
        continue;
      }
      const classification = classifyStatus(result, attempt, this.deps.now());
      if (classification.kind === "ok") return this.accepted(op, result);
      if (classification.kind === "failed") return { outcome: "failed" };
      if (attempt + 1 >= MAX_ATTEMPTS_PER_FLUSH) break;
      await this.deps.sleep(classification.delayMs);
    }
    return { outcome: "defer" };
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
