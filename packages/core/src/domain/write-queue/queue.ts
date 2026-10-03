import { classifyStatus, computePacingDelay } from "./classify";
import { coalesce } from "./coalesce";
import type { DispatchResult, QueuedOp, RequestDescriptor } from "./types";

const MAX_ATTEMPTS_PER_FLUSH = 5;

export interface WriteQueueDeps {
  readonly dispatch: (req: RequestDescriptor) => Promise<DispatchResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
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
    for (let op = this.pending[0]; op !== undefined; op = this.pending[0]) {
      this.inFlight = op;
      const outcome = await this.deliver(op);
      this.inFlight = null;
      if (outcome === "defer") break;
      this.pending.shift();
      if (outcome === "done") completed.push(op);
      else failed.push({ op, inversePatch: op.inversePatch });
    }
    return { completed, failed };
  }

  private async deliver(op: QueuedOp): Promise<Outcome> {
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
          return "defer";
        }
        if (applied) return "done";
        continue;
      }
      const classification = classifyStatus(result, attempt, this.deps.now());
      if (classification.kind === "ok") return "done";
      if (classification.kind === "failed") return "failed";
      if (attempt + 1 >= MAX_ATTEMPTS_PER_FLUSH) break;
      await this.deps.sleep(classification.delayMs);
    }
    return "defer";
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
