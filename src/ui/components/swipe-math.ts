/**
 * Pure gesture math for the SwipeAction wrapper, separated from the pointer
 * plumbing so the intent lock and commit rules are unit-testable.
 */

/** Horizontal travel past which a released swipe commits its action. */
const SWIPE_COMMIT_PX = 96;

/** Displacement at which the gesture locks to one axis, so vertical scroll
 * never smears into a horizontal swipe (and vice versa). */
const INTENT_LOCK_PX = 12;

/** `pending` = under the lock radius; `horizontal` = ours; `vertical` = the
 * scroller's, so release the gesture entirely. */
export type SwipeIntent = "pending" | "horizontal" | "vertical";

export function resolveIntent(
  dx: number,
  dy: number,
  lockPx: number = INTENT_LOCK_PX,
): SwipeIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < lockPx && ay < lockPx) return "pending";
  return ax > ay ? "horizontal" : "vertical";
}

/** Clamp the track offset to the directions that actually have an action;
 * a side with no handler doesn't budge. */
export function clampOffset(dx: number, canRight: boolean, canLeft: boolean): number {
  if (dx > 0) return canRight ? dx : 0;
  return canLeft ? dx : 0;
}

/** Which action (if any) a release at `offset` commits. */
export function commitDirection(
  offset: number,
  thresholdPx: number = SWIPE_COMMIT_PX,
): "right" | "left" | null {
  if (offset >= thresholdPx) return "right";
  if (offset <= -thresholdPx) return "left";
  return null;
}
