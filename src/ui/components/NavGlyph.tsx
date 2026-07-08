import type { ReactElement, ReactNode } from "react";

/** The shared nav-icon shell: a 24×24 stroked svg used by every bottom-nav and
 * sidebar destination. Callers supply only the inner path(s) as `children`. */
export function NavGlyph({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      className="nav__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
