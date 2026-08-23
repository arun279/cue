/**
 * Pure timing rules for the mark loop: rapid-fire marks coalesce into the
 * rolling snackbar batch, and the queue check waits on its re-arm gate. Kept free of React and cache
 * types so both are unit-testable on the clock alone.
 */

/** Marks landing within this window of the previous one coalesce into one
 * snackbar batch whose Undo reverses them all; a later mark starts a new batch. */
const UNDO_WINDOW_MS = 5000;

/** The visual floor of the reverse window: even when the authoritative next
 * episode lands instantly, the filled check stays a live undo toggle this long
 * (doubles as double-tap protection: taps inside it toggle, never double-mark). */
const REARM_MIN_MS = 280;

interface Stamped {
  readonly at: number;
}

/**
 * Append a mark to the rolling batch: within the window it coalesces onto the
 * existing batch; past it the batch has already left the screen, so the new mark
 * starts a fresh one.
 */
export function appendToBatch<T extends Stamped>(
  batch: readonly T[],
  entry: T,
  windowMs: number = UNDO_WINDOW_MS,
): readonly T[] {
  const last = batch[batch.length - 1];
  if (last !== undefined && entry.at - last.at > windowMs) return [entry];
  return [...batch, entry];
}

/**
 * How long until a just-marked queue check re-arms for the next episode.
 * `null` while the optimistic advance still awaits its authoritative next
 * episode (the check must stay a live undo toggle: marking a guessed coordinate
 * is forbidden); otherwise the remainder of the minimum visual window, floored
 * at zero.
 */
export function reArmDelay(
  markedAt: number,
  pendingAdvance: boolean,
  now: number,
  minMs: number = REARM_MIN_MS,
): number | null {
  if (pendingAdvance) return null;
  return Math.max(0, markedAt + minMs - now);
}
