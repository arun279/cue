import type { ReactElement } from "react";

/** The amber-check glyph shared by the Up Next spotlight and Show-page mark CTAs. */
export function CheckIcon(): ReactElement {
  return (
    <svg
      className="button__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
