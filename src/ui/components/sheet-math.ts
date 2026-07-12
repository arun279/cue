/**
 * Pure drag math for the bottom Sheet, separated from the pointer plumbing so
 * the settle decision (snap back, change detent, or dismiss) and the release
 * velocity are unit-testable.
 */

/** Release speed (px/ms, downward positive) past which a flick overrides
 * nearest-stop snapping. */
const FLICK_VELOCITY = 0.5;

/** Fraction of the visible sheet a quiet release must travel past the lowest
 * detent before it dismisses. */
export const DISMISS_FRACTION = 0.3;

/** Trailing window (ms) the release velocity is measured over, so an early
 * fast drag that ends in a hold doesn't read as a flick. */
const VELOCITY_WINDOW_MS = 100;

/** Ignore a stop within this distance of the current offset when flicking, so
 * a flick from a resting detent always travels to the NEXT stop. */
const STOP_EPSILON_PX = 1;

export interface DragSample {
  /** Event timestamp (ms). */
  readonly t: number;
  /** Sheet offset from the top-most detent (px, downward positive). */
  readonly y: number;
}

export type SheetSettle =
  | { readonly kind: "detent"; readonly y: number }
  | { readonly kind: "dismiss" };

/**
 * Where a released sheet settles. `y` is the current offset from the top-most
 * detent (0), `stops` the resting offsets, `dismissY` the travel past which a
 * quiet release dismisses. A flick moves one stop in its direction (downward
 * past the last stop = dismiss); anything slower snaps to the nearest stop
 * unless the sheet is already past the dismiss line.
 */
export function settleSheet(
  y: number,
  velocity: number,
  stops: readonly number[],
  dismissY: number,
): SheetSettle {
  const sorted = [...stops].sort((a, b) => a - b);
  const top = sorted[0] ?? 0;
  if (velocity >= FLICK_VELOCITY) {
    const below = sorted.find((stop) => stop > y + STOP_EPSILON_PX);
    return below === undefined ? { kind: "dismiss" } : { kind: "detent", y: below };
  }
  if (velocity <= -FLICK_VELOCITY) {
    const above = sorted.filter((stop) => stop < y - STOP_EPSILON_PX).pop();
    return { kind: "detent", y: above ?? top };
  }
  if (y >= dismissY) return { kind: "dismiss" };
  let nearest = top;
  for (const stop of sorted) {
    if (Math.abs(stop - y) < Math.abs(nearest - y)) nearest = stop;
  }
  return { kind: "detent", y: nearest };
}

/** Velocity (px/ms) over the trailing sample window; 0 until two samples land. */
export function releaseVelocity(samples: readonly DragSample[]): number {
  const last = samples[samples.length - 1];
  if (last === undefined) return 0;
  const anchor = samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS);
  if (anchor === undefined || anchor.t === last.t) return 0;
  return (last.y - anchor.y) / (last.t - anchor.t);
}
