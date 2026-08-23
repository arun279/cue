import type { ReactElement, ReactNode } from "react";

type BadgeVariant = "count" | "plays" | "media-type" | "countdown" | "paused" | "year";

interface BadgeProps {
  readonly children: ReactNode;
  readonly variant?: BadgeVariant;
  readonly testId?: string;
}

/**
 * The small status pill (remaining count, `×2` plays, SHOW/MOVIE type, `2d`
 * countdown, PAUSED, year). One shape, 11/700 on the elevated surface; variants
 * only tint or letter-space, never re-shape.
 */
export function Badge({ children, variant = "count", testId }: BadgeProps): ReactElement {
  return (
    <span
      className="badge-pill"
      data-variant={variant}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {children}
    </span>
  );
}
