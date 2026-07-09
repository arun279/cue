import type { ReactElement } from "react";
import { CheckIcon } from "./CheckIcon";

interface MarkWatchedButtonProps {
  /** Full accessible name for the ACTION, e.g. "Mark The Bear S01E05 watched". The
   * control is icon-only, so this name is the only label a screen reader gets — it
   * must be the complete action (WCAG 4.1.2). */
  readonly ariaLabel: string;
  readonly testId: string;
  /** Watched STATE — the ONLY thing that changes the look. Unwatched → an amber RING
   * (your turn: tap to log). Watched → the same circle FILLED amber with a check
   * (done). Never driven by the card / list / lead the control happens to sit in. */
  readonly watched?: boolean;
  /** State-aware accessible name for the done indicator, e.g. "Aired Today S01E02
   * watched". Falls back to `ariaLabel` when omitted. Used only when `watched`. */
  readonly watchedAriaLabel?: string;
  /** In-flight lock (e.g. Up Next's optimistic advance). Expressed with
   * `aria-disabled`, not the native attribute, so the button keeps DOM focus while its
   * write settles; the owning hook guards against a duplicate activation. */
  readonly busy?: boolean;
  onMark(): void;
}

/**
 * The Cue mark — the app's one shared mark-watched control, rendered IDENTICALLY on
 * every list row (Up Next, the lapsed drawer, the calendar). Its look is a pure
 * function of watched STATE, never of where it sits: unwatched is a 56px amber RING,
 * watched is that circle FILLED amber with a check. There is no text label — the title
 * reclaims that horizontal space and may wrap — so the accessible name carries the
 * whole action, and there is deliberately NO variant / size / lead prop and no
 * container-class hook. An action control is styled by WHAT IT DOES, never WHERE IT
 * SITS. Reversal is not a re-tap here: an in-place done row is reversed durably from
 * History; the point-of-action Undo (the owning hook's snackbar) covers an accidental tap.
 */
export function MarkWatchedButton({
  ariaLabel,
  testId,
  watched = false,
  watchedAriaLabel,
  busy = false,
  onMark,
}: MarkWatchedButtonProps): ReactElement {
  if (watched) {
    return (
      <span
        className="cue-mark cue-mark--done"
        data-testid={testId}
        role="img"
        aria-label={watchedAriaLabel ?? ariaLabel}
      >
        <CheckIcon />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="cue-mark"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={onMark}
    />
  );
}
