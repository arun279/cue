/**
 * The one axis lock both drag gestures resolve against: a row swipe and a pull
 * share the same surface, so they have to agree on the moment a drag stops being
 * either and becomes one of them.
 */

/** Displacement at which a gesture locks to one axis, so vertical scrolling
 * never smears into a horizontal swipe (and vice versa). */
const INTENT_LOCK_PX = 12;

/** `pending` = under the lock radius; the axis names which gesture the drag
 * belongs to, so the other one lets go of it entirely. */
export type GestureIntent = "pending" | "horizontal" | "vertical";

export function resolveIntent(
  dx: number,
  dy: number,
  lockPx: number = INTENT_LOCK_PX,
): GestureIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < lockPx && ay < lockPx) return "pending";
  return ax > ay ? "horizontal" : "vertical";
}
