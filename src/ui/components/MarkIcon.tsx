import type { ReactElement } from "react";

/**
 * The mark-watched ACTION glyph: a plus ("add a play"), deliberately NOT the ✓ that
 * denotes a watched STATE (the season-shelf badge, the calendar "Watched" pill, the
 * "On watchlist ✓" toggle). Reserving the check for done-states is what stops a
 * to-watch queue from reading as already-watched. Shared by every one-shot
 * mark control — Up Next, Calendar, and the Show-detail hero / next-up — so the
 * action reads the same everywhere (Nielsen #4 / Shneiderman #1 consistency).
 */
export function MarkIcon({ className = "button__icon" }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
