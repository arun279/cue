import type { ReactElement } from "react";

/** The disclosure chevron shared by every accordion trigger: library piles, diary
 * clusters, season shelves, and the lapsed drawer. Only the wrapper class differs
 * per surface, so callers pass their own `className`. */
export function ChevronIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
