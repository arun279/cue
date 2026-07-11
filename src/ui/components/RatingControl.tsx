import type { EpisodeIds, MovieIds, ShowIds } from "@domain/model/ids";
import type { RateController } from "@ui/hooks/useRate";
import { type KeyboardEvent, type PointerEvent, type ReactElement, useRef, useState } from "react";

/** Trakt ratings are 1-10; 0 is our sentinel for "cleared / not rated" so the whole
 * track (including its far-left) has a meaning and the slider always carries a value. */
const MIN = 0;
const MAX = 10;

interface RatingControlProps {
  readonly ids: ShowIds | EpisodeIds | MovieIds;
  readonly label: string;
  readonly controller: RateController;
  readonly testId: string;
}

/** Nearest integer 0-10 for a pointer x within the track. The whole track is the
 * target, so a tap anywhere lands on the closest value (dragging past 0 clears). */
function valueFromPointer(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  const frac = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
  const clamped = Math.min(1, Math.max(0, frac));
  return Math.round(clamped * MAX);
}

/**
 * The 1-10 rating control. Ten 44px stars would need 440px: wider than a
 * phone: so per-value hit areas can never be WCAG-compliant. This is instead a single
 * `role="slider"` TRACK: the whole bar is one finger target, tap-or-drag sets the value,
 * and a big numeric readout makes it unmistakable. It is keyboard-operable (arrows /
 * Home / End), announces `aria-valuenow`/`aria-valuetext`, carries a visible focus ring,
 * and works at 320px because the track is fluid (100% width). Sliding to 0: or the
 * Clear action that appears once rated: removes the rating.
 */
export function RatingControl({
  ids,
  label,
  controller,
  testId,
}: RatingControlProps): ReactElement {
  const current = controller.ratingFor(ids.trakt);
  const [drag, setDrag] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);

  // Lock the track until the existing-ratings read resolves so a tap can't fire a
  // write against unknown prior state (e.g. re-rating an already-set value).
  const locked = controller.isLoading;
  const displayed = drag !== null ? drag : (current ?? 0);
  const readout = displayed === 0 ? null : displayed;
  const status = controller.isLoading
    ? "Loading your rating…"
    : controller.isError
      ? "Couldn't load your rating."
      : current === null
        ? "Not rated"
        : `Your rating: ${current}/10`;

  function commit(value: number): void {
    if (value === 0) void controller.clearRating(ids);
    else void controller.rate(ids, value);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = e.pointerId;
    setDrag(valueFromPointer(e.currentTarget, e.clientX));
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (draggingRef.current !== e.pointerId) return;
    setDrag(valueFromPointer(e.currentTarget, e.clientX));
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>): void {
    if (draggingRef.current !== e.pointerId) return;
    draggingRef.current = null;
    const value = valueFromPointer(e.currentTarget, e.clientX);
    setDrag(null);
    commit(value);
  }
  function onPointerCancel(): void {
    draggingRef.current = null;
    setDrag(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (locked) return;
    const base = current ?? 0;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(MAX, base + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(MIN, base - 1);
        break;
      case "Home":
        next = MIN;
        break;
      case "End":
        next = MAX;
        break;
      default:
        return;
    }
    e.preventDefault();
    commit(next);
  }

  return (
    <div className="rating" data-testid={testId}>
      <div className="rating__row">
        <div className="rating__readout" aria-hidden="true">
          <span className="rating__value" data-empty={readout === null}>
            {readout ?? "-"}
          </span>
          <span className="rating__max">/10</span>
        </div>
        <div
          role="slider"
          className="rating__slider"
          tabIndex={locked ? -1 : 0}
          aria-label={`${label}: your rating, 0 to 10`}
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={displayed}
          aria-valuetext={readout === null ? "Not rated" : `${readout} out of 10`}
          aria-busy={locked}
          aria-disabled={locked}
          data-testid={`${testId}-slider`}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <span className="rating__track">
            <span className="rating__fill" style={{ width: `${displayed * 10}%` }} />
            <span className="rating__ticks" aria-hidden="true" />
          </span>
        </div>
      </div>
      <div className="rating__foot">
        <p className="rating__status" data-testid={`${testId}-current`} aria-live="polite">
          {status}
        </p>
        {current !== null && !locked && (
          <button
            type="button"
            className="rating__clear"
            data-testid={`${testId}-clear`}
            onClick={() => void controller.clearRating(ids)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
