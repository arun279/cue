import type { ReactElement } from "react";

/** The detail-page loading silhouette: a hero-shaped shimmer plate over a title
 * bar and three season-row blocks, matching the final layout so there is no
 * shift on load. `aria-hidden`: the screen announces loading, not empty rows. */
export function DetailHeroSkeleton({
  testId,
  rows = 3,
}: {
  readonly testId: string;
  readonly rows?: number;
}): ReactElement {
  return (
    <div className="detail-skel" data-testid={testId} aria-hidden="true">
      <div className="detail-skel__hero" />
      <div className="detail-skel__bar detail-skel__bar--title" />
      {Array.from({ length: rows }, (_, index) => index).map((row) => (
        <div key={row} className="detail-skel__row" />
      ))}
    </div>
  );
}
