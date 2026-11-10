import { sleep } from "../../domain/abortable";
import { healsOnRetry, type TraktFailure } from "../../domain/read-failure";
import { jitteredBackoffMs } from "../../domain/write-queue/classify";
import type { TraktPolicy } from "./policy";

type ReadResult = { readonly ok: true } | { readonly ok: false; readonly error: TraktFailure };

const subscriber =
  (listeners: Set<() => void>) =>
  (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

/** The reads of one session: how many are in flight, and how long Trakt has asked them to wait. */
export class ReadBudget {
  // Trakt's rate limits apply per window, and its 429 guidance is to pause all requests for Retry-After.
  private resumeReadsAt = 0;
  private readonly pauseListeners = new Set<() => void>();
  // Failures the library load is retrying past, published like the pause to the screens waiting.
  private readonly retrying = new Map<symbol, TraktFailure>();
  private readonly retryListeners = new Set<() => void>();
  private retryFailure: TraktFailure | null = null;
  private readonly waitingForSlot: (() => void)[] = [];
  private readsInFlight = 0;
  private readonly policy: TraktPolicy;
  private readonly signal: AbortSignal | undefined;

  constructor(policy: TraktPolicy, signal?: AbortSignal) {
    this.policy = policy;
    this.signal = signal;
  }

  readonly readsPausedUntil = (): number => this.resumeReadsAt;
  readonly subscribeReadPause = subscriber(this.pauseListeners);
  readonly readRetryFailure = (): TraktFailure | null => this.retryFailure;
  readonly subscribeReadRetry = subscriber(this.retryListeners);

  async withRateRetry<R extends ReadResult>(read: () => Promise<R>): Promise<R> {
    const { retries, backoffMs } = this.policy.rateLimit;
    await this.acquireReadSlot();
    try {
      for (let attempt = 0; ; attempt += 1) {
        await this.waitOutPause();
        const result = await read();
        if (result.ok || result.error.kind !== "rate-limited") return result;
        const { retryAfterMs } = result.error;
        // Trakt's guidance: pause everything for Retry-After, and without it back off with jitter,
        // which a shared pause would undo by releasing every waiting read at once.
        if (retryAfterMs !== null) this.pauseReadsUntil(Date.now() + retryAfterMs);
        if (attempt >= retries) return result;
        if (retryAfterMs === null) await sleep(jitteredBackoffMs(attempt, backoffMs), this.signal);
      }
    } finally {
      this.releaseReadSlot();
    }
  }

  /** Also retries a read that failed in transit or on Trakt's side, so a single failure costs
   * that read again rather than the whole library. */
  async withRetry<R extends ReadResult>(read: () => Promise<R>): Promise<R> {
    const id = Symbol("read");
    try {
      for (let attempt = 1; ; attempt += 1) {
        const result = await this.withRateRetry(read);
        if (result.ok || !healsOnRetry(result.error) || attempt >= this.policy.readAttempts) {
          return result;
        }
        this.setRetrying(id, result.error);
        await sleep(jitteredBackoffMs(attempt - 1, this.policy.retryDelayMs), this.signal);
      }
    } finally {
      this.setRetrying(id, null);
    }
  }

  private async waitOutPause(): Promise<void> {
    while (!this.signal?.aborted && this.resumeReadsAt > Date.now()) {
      await sleep(this.resumeReadsAt - Date.now(), this.signal);
    }
  }

  private pauseReadsUntil(at: number): void {
    if (at <= this.resumeReadsAt) return;
    this.resumeReadsAt = at;
    for (const listener of this.pauseListeners) listener();
  }

  private setRetrying(read: symbol, failure: TraktFailure | null): void {
    if (failure === null) this.retrying.delete(read);
    else this.retrying.set(read, failure);
    const latest = [...this.retrying.values()].at(-1) ?? null;
    if (latest === this.retryFailure) return;
    this.retryFailure = latest;
    for (const listener of this.retryListeners) listener();
  }

  private async acquireReadSlot(): Promise<void> {
    if (this.readsInFlight < this.policy.readConcurrency) {
      this.readsInFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waitingForSlot.push(resolve));
  }

  private releaseReadSlot(): void {
    const next = this.waitingForSlot.shift();
    if (next === undefined) this.readsInFlight -= 1;
    else next();
  }
}
