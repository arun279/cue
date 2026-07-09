import type { ReactElement } from "react";
import { CheckIcon } from "./CheckIcon";
import { MarkIcon } from "./MarkIcon";

interface WatchedFieldProps {
  /** Watched STATE — the ONLY thing that drives the look. Unwatched → the amber ACTION
   * (a ring glyph + "Mark watched"); watched → the green "done" language (a check +
   * "Watched"), deliberately NOT an amber fill so a recorded watch is never mistaken
   * for a live CTA (amber stays reserved for action / "you are here"). */
  readonly watched: boolean;
  /** Visible, state-driven label — "Mark watched" / "Watched" / "Not aired yet". */
  readonly label: string;
  /** State-aware full accessible name: "Mark <x> watched" when unwatched, "Mark <x>
   * unwatched" when watched — so a screen reader never hears a stale "Mark watched" on
   * an already-watched control (WCAG 4.1.2). */
  readonly ariaLabel: string;
  /** Not-yet-actionable (an episode that hasn't aired): inert, no press. */
  readonly disabled?: boolean;
  /** Relative watched date shown beside the done state, or null. */
  readonly watchedDate: string | null;
  readonly testId: string;
  readonly dateTestId: string;
  onToggle(): void;
}

/**
 * The Cue mark on a DETAIL screen: the page's primary watched control — a
 * full-width labeled button shared IDENTICALLY by episode and movie detail. It is ONE
 * component, styled by its watched STATE, never by which screen it sits on. It flips in
 * place ring→check on the FIRST frame (no color transition); re-tapping performs a
 * deliberate, per-play-safe unmark through the owning hook (a single play removed by
 * its exact history id; a rewatch refused and routed to watch history), and durable
 * per-play reversal lives in History. The row form of the same mark is the icon-only
 * `MarkWatchedButton`; both share the ring(action)/check(done) glyph vocabulary, so the
 * action reads the same everywhere — an action control is styled by WHAT IT DOES, never
 * WHERE IT SITS.
 */
export function WatchedField({
  watched,
  label,
  ariaLabel,
  disabled = false,
  watchedDate,
  testId,
  dateTestId,
  onToggle,
}: WatchedFieldProps): ReactElement {
  return (
    <>
      <button
        type="button"
        className="button button--block watched-field"
        data-on={watched}
        disabled={disabled}
        data-testid={testId}
        aria-label={ariaLabel}
        onClick={onToggle}
      >
        {watched ? <CheckIcon /> : <MarkIcon />}
        <span>{label}</span>
      </button>
      {watched && watchedDate !== null && (
        <span className="episode-status__date" data-testid={dateTestId}>
          Watched {watchedDate}
        </span>
      )}
    </>
  );
}
