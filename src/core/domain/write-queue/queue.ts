import { classifyStatus, computePacingDelay, RETRY_AFTER_MAX_MS } from "./classify";
import { resolvedUndo } from "./ops";
import type { DispatchResult, QueuedOp, RequestDescriptor } from "./types";

const MAX_ATTEMPTS_PER_FLUSH = 5;
// No wait Trakt asks for is longer, so a write it has refused for that long is not waiting out a limit.
const GIVE_UP_AFTER_MS = RETRY_AFTER_MAX_MS;

/** How a write ended: on Trakt, refused by it, or cancelled by an opposite write before either was sent. */
export type WriteOutcome = "done" | "failed" | "cancelled";

/** Where a write stands: not sent yet, sent and possibly on Trakt already, or how it ended. */
export type WriteState = "unsent" | "sent" | WriteOutcome;

/** What Trakt did with a write it answered; "replaced" is a history add that overwrote an earlier play. */
export type Settlement = "applied" | "replaced" | "refused";

export interface WriteQueueDeps {
  readonly dispatch: (req: RequestDescriptor) => Promise<DispatchResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** Reads Trakt's answer to `op`. `firstSend` is false once an earlier send of it may have reached Trakt. */
  readonly settle: (op: QueuedOp, result: DispatchResult, firstSend: boolean) => Settlement;
  /** The history rows made by the add that `undo` takes back, read after that add was answered. */
  readonly ownPlays: (undo: QueuedOp) => Promise<readonly number[]>;
  readonly save: (ops: readonly QueuedOp[]) => Promise<void>;
}

interface Delivery {
  /** Fixed, apart from a take-back once its plays are found. */
  op: QueuedOp;
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
 * again. A take-back finds the plays it removes once, and keeps them before it is first sent, so no
 * later send removes a play made since.
 */
export class WriteQueue {
  private pending: Delivery[];
  private readonly deliveries = new Map<string, Delivery>();
  private lastDispatchAt: number | null = null;
  private resumeAt = 0;
  private readonly deps: WriteQueueDeps;
  private flushing: Promise<void> | null = null;

  /** `stored` comes back from the device, where each write may have been sent before the app stopped. */
  constructor(deps: WriteQueueDeps, stored: readonly QueuedOp[] = []) {
    this.deps = deps;
    this.pending = stored.map((op) => this.track(op, true));
  }

  get size(): number {
    return this.pending.length;
  }

  snapshot(): QueuedOp[] {
    return this.pending.map(({ op }) => op);
  }

  /** A write this queue has not been given yet is one it has not sent. */
  stateOf(id: string): WriteState {
    const delivery = this.deliveries.get(id);
    if (delivery === undefined) return "unsent";
    return delivery.outcome ?? (delivery.sent ? "sent" : "unsent");
  }

  settled(id: string): Promise<WriteOutcome> {
    const delivery = this.deliveries.get(id);
    if (delivery === undefined) throw new Error(`No write ${id} was queued.`);
    return delivery.settled;
  }

  /**
   * Queues `op` behind every earlier write. Against the last unsent write for the same item, a repeat
   * ends as that write does, and an opposite write cancels both. A take-back is never cancelled: the
   * add it takes back may already be on Trakt.
   */
  enqueue(op: QueuedOp): void {
    const twin = this.pending.findLast((queued) => queued.op.itemKey === op.itemKey);
    if (twin === undefined || twin.sent || twin.op.undoes !== undefined) {
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
      const firstSend = !next.sent;
      next.sent = true;
      const outcome = await this.deliver(next, firstSend);
      if (outcome === null) return;
      this.pending.shift();
      this.finish(next, outcome);
    }
  }

  /** The write's outcome, or null to keep it first in line for a later flush. */
  private async deliver(next: Delivery, firstSend: boolean): Promise<WriteOutcome | null> {
    if (next.op.undoes === undefined) return this.send(next, firstSend);
    let resolved: QueuedOp;
    try {
      const plays = await this.deps.ownPlays(next.op);
      if (plays.length === 0) return "done";
      resolved = resolvedUndo(next.op, plays);
      await this.deps.save(this.snapshot().map((op) => (op === next.op ? resolved : op)));
    } catch {
      return null;
    }
    next.op = resolved;
    return this.send(next, firstSend);
  }

  /** Taking back an add that replaced an earlier play would lose that play, so its take-backs fail. */
  private refuseTakeBacks(addId: string): void {
    const refused = this.pending.filter(({ op }) => op.undoes === addId);
    this.pending = this.pending.filter((queued) => !refused.includes(queued));
    for (const takeBack of refused) this.finish(takeBack, "failed");
  }

  private async send(next: Delivery, firstSend: boolean): Promise<WriteOutcome | null> {
    let first = firstSend;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_FLUSH; attempt += 1) {
      await this.pace();
      let result: DispatchResult;
      try {
        result = await this.deps.dispatch(next.op.request);
      } catch {
        return null;
      }
      const now = this.deps.now();
      const classification = classifyStatus(result, attempt, now);
      if (classification.kind === "ok") {
        const settlement = this.deps.settle(next.op, result, first);
        if (settlement === "replaced") this.refuseTakeBacks(next.op.id);
        return settlement === "refused" ? "failed" : "done";
      }
      if (classification.kind === "failed") return "failed";
      first = false;
      this.resumeAt = now + classification.delayMs;
      next.refusedSince ??= now;
      if (now - next.refusedSince >= GIVE_UP_AFTER_MS) return "failed";
    }
    return null;
  }

  /** Keeps writes a second apart, and holds the next one until Trakt's last asked-for wait is over. */
  private async pace(): Promise<void> {
    const now = this.deps.now();
    const wait = Math.max(computePacingDelay(now, this.lastDispatchAt), this.resumeAt - now);
    if (wait > 0) await this.deps.sleep(wait);
    this.lastDispatchAt = this.deps.now();
  }
}
