/**
 * Pure long-press rules for the ContextMenu wrapper, separated from the
 * pointer plumbing so the hold/cancel decisions are unit-testable.
 */

/** Hold duration before a press fires as a long-press. */
export const LONG_PRESS_MS = 500;

/** Pointer travel past which a press is a scroll or drag, never a hold. */
const PRESS_SLOP_PX = 10;

/** True when travel abandons the press (Euclidean, so diagonal drift counts
 * the same as axis-aligned movement). */
export function exceedsPressSlop(dx: number, dy: number, slopPx: number = PRESS_SLOP_PX): boolean {
  return Math.hypot(dx, dy) >= slopPx;
}
