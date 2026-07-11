import type { ReactElement } from "react";

/** The done-state check glyph shared by the Cue mark disc + the detail watched-field.
 * Color comes from context (green on a recorded watch: amber is reserved for action). */
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
