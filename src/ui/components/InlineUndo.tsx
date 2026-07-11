import type { ReactElement } from "react";

interface InlineUndoProps {
  /** Optional short past-tense confirmation shown beside the Undo, e.g. "Marked S01E02
   * watched". Omit where the point of action already reads as done (e.g. a green done
   * disc sitting right next to the Undo). */
  readonly label?: string;
  /** Full accessible name for the reversal, e.g. "Undo: mark Solo S01E02 unwatched",
   * so a screen reader hears the whole action, not a bare "Undo" (WCAG 4.1.2). */
  readonly ariaLabel: string;
  readonly testId: string;
  onUndo(): void;
}

/**
 * The point-of-action Undo: the PRIMARY reversal for a just-landed
 * mark, rendered INLINE on the very row/card where the tap happened: not a bottom
 * snackbar the user has to race. It reuses the owning
 * hook's reversal seam (`undoable` / `undo`); it never forks a new reversal path. The
 * Undo control is a full 44px finger target (the reversal is the trust anchor: it must
 * not be a text link a phone user keeps missing). The Snackbar stays as a SECONDARY
 * polite announcement, and the durable per-play reversal lives on, forever, in History.
 */
export function InlineUndo({ label, ariaLabel, testId, onUndo }: InlineUndoProps): ReactElement {
  return (
    <div className="inline-undo" data-testid={testId}>
      {label !== undefined && <span className="inline-undo__label">{label}</span>}
      <button
        type="button"
        className="inline-undo__action"
        data-testid={`${testId}-action`}
        aria-label={ariaLabel}
        onClick={onUndo}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
        </svg>
        Undo
      </button>
    </div>
  );
}
