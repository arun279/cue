import type { ReactElement } from "react";

/** The marquee card's loading placeholder: one shimmering 140px plate. */
export function SkeletonMarquee(): ReactElement {
  return <div className="skeleton-marquee" aria-hidden="true" />;
}

interface SkeletonRowsProps {
  readonly rows?: number;
  readonly testId?: string;
}

/**
 * Shimmering queue-row placeholders (poster block, two text bars, a progress
 * bar). `aria-hidden`: a screen reader hears the loading status, not empty rows.
 * The reduced-motion clamp freezes the shimmer to static elevated blocks.
 */
export function SkeletonRows({ rows = 6, testId }: SkeletonRowsProps): ReactElement {
  return (
    <div
      className="skeleton-rows"
      aria-hidden="true"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      {Array.from({ length: rows }, (_, index) => index).map((row) => (
        <div key={row} className="skeleton-row">
          <div className="skeleton-row__poster" />
          <div className="skeleton-row__body">
            <div className="skeleton-row__bar skeleton-row__bar--title" />
            <div className="skeleton-row__bar skeleton-row__bar--meta" />
            <div className="skeleton-row__bar skeleton-row__bar--progress" />
          </div>
        </div>
      ))}
    </div>
  );
}
