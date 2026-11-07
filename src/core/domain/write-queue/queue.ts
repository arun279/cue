import { classifyStatus, computePacingDelay, RETRY_AFTER_MAX_MS } from "./classify";
import type { DispatchResult, QueuedOp, RequestDescriptor } from "./types";

const MAX_ATTEMPTS_PER_FLUSH = 5;
// No wait Trakt asks for is longer, so a write it has refused for that long is not waiting out a limit.
const GIVE_UP_AFTER_MS = RETRY_AFTER_MAX_MS;

/** How a write ended: on Trakt, refused by it, or cancelled by an opposite write before either was sent. */
export type WriteOutcome = "done" | "failed" | "cancelled";

export interface WriteQueueDeps {
  readonly dispatch: (req: RequestDescriptor) => Promise<DispatchResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly settle: (op: QueuedOp, result: DispatchResult) => boolean;
}

interface Delivery {
  readonly op: QueuedOp;
  /** It may be on Trakt already, so no later write can cancel it. */
  sent: boolean;
  refusedSince: number | null;
  outcome: WriteOutcome | null;
  readonly settled: Promise<WriteOutcome>;
  readonly resolve: (outcome: WriteOutcome) => void;
}

/**
 * Sends writes to Trakt one at a time, in the order they were made. Every write Cue makes can be
 * sent again safely (a history add carries its own watched_at, which Trakt does not add twice:
 * trakt/trakt-api discussion #694), so a write whose answer is lost stays first in line and is sent
 * again.
 */
export class WriteQueue {
  private pending: Delivery[];
  private readonly deliveries = new Map<string, Delivery>();
  private lastDispatchAt: number | null = null;
  private readonly deps: WriteQueueDeps;
  private inFlight: Delivery | null = null;
  private flushing: Promise<void> | null = null;

  /** `stored` comes back from the device, where each write may have been sent before the app stopped. */
  constructor(deps: WriteQueueDeps, stored: readonly QueuedOp[] = []) {
    this.deps = deps;
    this.pending = stored.map((op) => this.track(op, true));
  }

  get size(): number {
    return this.pending.length;
  }

  get inFlightId(): string | null {
    return this.inFlight?.op.id ?? null;
  }

  snapshot(): QueuedOp[] {
    return this.pending.map(({ op }) => op);
  }

  /** How the write ended, or null while it is still to be sent. */
  outcomeOf(id: string): WriteOutcome | null {
    return this.deliveries.get(id)?.outcome ?? null;
  }

  settled(id: string): Promise<WriteOutcome> {
    const delivery = this.deliveries.get(id);
    if (delivery === undefined) throw new Error(`No write ${id} was queued.`);
    return delivery.settled;
  }

  /**
   * Queues `op` behind every earlier write. Against the last unsent write for the same item, a repeat
   * ends as that write does, and an opposite write cancels both.
   */
  enqueue(op: QueuedOp): void {
    const twin = this.pending.findLast((queued) => queued.op.itemKey === op.itemKey);
    if (twin === undefined || twin.sent) {
      this.pending.push(this.track(op, false));
    } else if (twin.op.toState === op.toState) {
      this.deliveries.set(op.id, twin);
    } else {
      this.pending = this.pending.filter((queued) => queued !== twin);
      this.finish(twin, "cancelled");
      this.finish(this.track(op, false), "cancelled");
    }
  }

  flush(): Promise<void> {
    if (this.flushing !== null) return this.flushing;
    const run = this.drain().finally(() => {
      this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  private track(op: QueuedOp, sent: boolean): Delivery {
    let resolve: (outcome: WriteOutcome) => void = () => undefined;
    const settled = new Promise<WriteOutcome>((settle) => {
      resolve = settle;
    });
    const delivery: Delivery = { op, sent, refusedSince: null, outcome: null, settled, resolve };
    this.deliveries.set(op.id, delivery);
    return delivery;
  }

  private finish(delivery: Delivery, outcome: WriteOutcome): void {
    delivery.outcome = outcome;
    delivery.resolve(outcome);
  }

  private async drain(): Promise<void> {
    for (let next = this.pending[0]; next !== undefined; next = this.pending[0]) {
      this.inFlight = next;
      next.sent = true;
      const outcome = await this.deliver(next);
      this.inFlight = null;
      if (outcome === null) return;
      this.pending.shift();
      this.finish(next, outcome);
    }
  }

  /** The write's outcome, or null to keep it first in line for a later flush. */
  private async deliver(next: Delivery): Promise<WriteOutcome | null> {
    for (let attempt = 0; ; attempt += 1) {
      await this.pace();
      let result: DispatchResult;
      try {
        result = await this.deps.dispatch(next.op.request);
      } catch {
        return null;
      }
      const classification = classifyStatus(result, attempt, this.deps.now());
      if (classification.kind === "ok")
        return this.deps.settle(next.op, result) ? "done" : "failed";
      if (classification.kind === "failed") return "failed";
      next.refusedSince ??= this.deps.now();
      if (attempt + 1 >= MAX_ATTEMPTS_PER_FLUSH) {
        return this.deps.now() - next.refusedSince >= GIVE_UP_AFTER_MS ? "failed" : null;
      }
      await this.deps.sleep(classification.delayMs);
    }
  }

  private async pace(): Promise<void> {
    const wait = computePacingDelay(this.deps.now(), this.lastDispatchAt);
    if (wait > 0) await this.deps.sleep(wait);
    this.lastDispatchAt = this.deps.now();
  }
}
