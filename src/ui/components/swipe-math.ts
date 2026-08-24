/**
 * Pure gesture math for the SwipeAction wrapper, separated from the pointer
 * plumbing so the commit rules are unit-testable. The axis lock it resolves
 * against is shared with the pull region and lives in gesture-intent.
 */

/** Horizontal travel past which a released swipe commits its action. */
const SWIPE_COMMIT_PX = 96;

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
