import type { ReactElement } from "react";
import { MarkIcon } from "./MarkIcon";

interface MarkWatchedButtonProps {
  /** Visible action wording, e.g. "Mark watched" — an ACTION to take, never the
   * past-tense "Watched" that reads as a completed state on an unwatched card. */
  readonly label: string;
  /** Full accessible name, e.g. "Mark The Bear S01E05 watched". */
  readonly ariaLabel: string;
  readonly testId: string;
  readonly className?: string;
  /** In-flight lock (e.g. Up Next's optimistic advance). Expressed with
   * `aria-disabled`, not the native attribute, so the button keeps DOM focus while
   * its write settles; the owning hook guards against a duplicate activation. */
  readonly busy?: boolean;
  onMark(): void;
}

/**
 * The one shared mark-watched control: a plus glyph + an
 * action label, used across Up Next and the Calendar so the same action never
 * appears as a gold ✓ pill on one screen and a bare icon on another. Styling rides
 * `card__mark`; callers add a modifier class for the lead / calendar variants.
 */
export function MarkWatchedButton({
  label,
  ariaLabel,
  testId,
  className,
  busy = false,
  onMark,
}: MarkWatchedButtonProps): ReactElement {
  // Split off the trailing word ("watched") into its own span so a phone can drop it
  // for density — the button reads "Mark" there — while the full label stays on
  // desktop and the accessible name (ariaLabel) is always the complete action.
  const words = label.split(" ");
  const suffix = words.length > 1 ? (words.pop() ?? null) : null;
  const base = words.join(" ");
  return (
    <button
      type="button"
      className={className === undefined ? "card__mark" : `card__mark ${className}`}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={onMark}
    >
      <MarkIcon className="card__check" />
      <span className="card__mark-text">
        {base}
        {suffix !== null && <span className="card__mark-suffix"> {suffix}</span>}
      </span>
    </button>
  );
}
