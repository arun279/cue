import type { ReactElement } from "react";

/**
 * The mark-watched ACTION glyph: an open RING ("not done — your turn to log"),
 * deliberately NOT the ✓ that denotes a watched STATE (the CheckIcon done-badge). One
 * glyph family, one meaning: a ring is the action, a filled check is done. Reserving
 * the check for done-states is what stops a to-watch item from reading as already
 * watched. Shared by every labeled mark control — the show-detail hero /
 * next-up, the season header, and the episode / movie detail toggle — so the action
 * reads the same everywhere (Nielsen #4 / Shneiderman #1 consistency). The icon-only
 * row control (the Cue mark) draws its ring from the button border, not this glyph.
 */
export function MarkIcon({ className = "button__icon" }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
