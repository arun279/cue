import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

interface SectionHeaderProps {
  /** Rendered in caps by the label style; pass sentence case ("On the way"). */
  readonly label: string;
  /** Trailing amber link, e.g. `Calendar ›` → /calendar. */
  readonly link?: {
    readonly label: string;
    readonly to: "/calendar" | "/history";
    readonly testId?: string;
  };
  readonly testId?: string;
}

/**
 * The quiet section label (13/600 caps) with an optional trailing amber link.
 * The collapsible-with-count variant is the lapsed drawer's disclosure trigger,
 * which reuses these classes inside its own button.
 */
export function SectionHeader({ label, link, testId }: SectionHeaderProps): ReactElement {
  return (
    <div className="section-header" {...(testId === undefined ? {} : { "data-testid": testId })}>
      <h2 className="section-header__label">{label}</h2>
      {link !== undefined && (
        <Link
          to={link.to}
          className="section-header__link"
          {...(link.testId === undefined ? {} : { "data-testid": link.testId })}
        >
          {link.label} ›
        </Link>
      )}
    </div>
  );
}
