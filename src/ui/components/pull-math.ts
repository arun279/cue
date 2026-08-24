/**
 * Pure gesture math for the PullToRefresh wrapper, separated from the pointer
 * plumbing so the resistance curve, the arm threshold and the settle window are
 * unit-testable. The numbers are Material 3's published pull-to-refresh
 * defaults: Android documents them and Apple documents none, so the curve that
 * exists beats one invented here, and it is the same curve the platform control
 * would give a native app on one of Cue's two targets.
 */

/** Travel past which a released pull runs the refresh (`PositionalThreshold`, 80.dp). */
export const PULL_THRESHOLD_PX = 80;

/** The pull tracks the finger at half rate (`DragMultiplier`), which is what
 * produces the rubber band a WebView cannot borrow from the scroller: Capacitor
 * turns iOS bounce off (so a UIRefreshControl is never revealed) and Android
 * WebView ships no pull gesture at all, and neither native control could reach a
 * DOM scroll region anyway. That is the whole reason the gesture is in the DOM. */
const DRAG_MULTIPLIER = 0.5;

/** Material limits the overshoot to 200% of the threshold; the tension curve
 * below reaches exactly that at this much linear overshoot and never passes it. */
const MAX_OVERSHOOT = 2;

/** How long the indicator stays up at minimum, so a pass that resolves off a
 * warm cache reads as a refresh instead of a flicker. */
const MIN_SPIN_MS = 600;

/** Where the indicator sits for `dragPx` of finger travel: linear at half rate
 * to the threshold, then Material's tension curve (`t - t²/4`), which flattens
 * to a dead stop at twice the threshold. */
export function pullDistance(dragPx: number, threshold: number = PULL_THRESHOLD_PX): number {
  const pulled = Math.max(0, dragPx) * DRAG_MULTIPLIER;
  if (pulled <= threshold) return pulled;
  const overshoot = Math.min(pulled / threshold - 1, MAX_OVERSHOOT);
  return threshold + threshold * (overshoot - overshoot ** 2 / 4);
}

/** Whether releasing here runs the refresh. The tension curve is monotonic, so
 * this is the same instant the finger passes the threshold. */
export function isArmed(distance: number, threshold: number = PULL_THRESHOLD_PX): boolean {
  return distance >= threshold;
}

/** 0 → 1 as the pull approaches the threshold: the indicator's sweep. */
export function pullProgress(distance: number, threshold: number = PULL_THRESHOLD_PX): number {
  return Math.min(1, Math.max(0, distance / threshold));
}

/** How much longer the indicator must stay up before the pull may settle back. */
export function settleDelayMs(elapsedMs: number, minimumMs: number = MIN_SPIN_MS): number {
  return Math.max(0, minimumMs - elapsedMs);
}
