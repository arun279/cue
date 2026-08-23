/**
 * Raised by the runtime's teardown when a normal disconnect can't be honored
 * because durable writes are still queued (offline / rate-limited) and the flush
 * couldn't drain them. Clearing the op-log would lose those writes; keeping it
 * across sign-out would risk them replaying under a different account: so the
 * disconnect is refused and the user asked to reconnect first. The dead-token
 * teardown passes `{ force: true }`, which clears regardless (a dead token can't
 * send the writes anyway, and clearing is what stops the cross-account replay).
 */
export class PendingWritesError extends Error {
  constructor() {
    super("Some changes haven't synced yet.");
    this.name = "PendingWritesError";
  }
}

/** How the caller wants the local session torn down. */
export interface TeardownOptions {
  /** Clear caches even if pending writes couldn't be flushed (dead-token path). */
  readonly force?: boolean;
}

/**
 * A mutable handoff between the runtime: which owns the durable write-queue and
 * this device's caches: and the auth store's `disconnect`/`endSession`, which
 * live above the runtime and can't reach it directly. `RuntimeBoot` registers the
 * live runtime's `endLocalSession` here; the auth store awaits it (flush pending
 * writes + clear the op-log, last-activities baseline, and persisted query cache)
 * before it revokes and clears the token. A normal disconnect throws
 * {@link PendingWritesError} when writes can't be flushed; the dead-token path
 * forces the clear. Resets to a no-op whenever no runtime is mounted.
 */
export const sessionTeardown: { run: (options?: TeardownOptions) => Promise<void> } = {
  run: () => Promise.resolve(),
};
