import type { ReactElement } from "react";

/** The shared loading silhouette for the Show and Episode media heroes: a
 * poster-shaped block beside title/sub lines, matching the final hero layout so
 * there is no shift on load (Rams 8). */
export function DetailHeroSkeleton({ testId }: { readonly testId: string }): ReactElement {
  return (
    <div className="show-hero show-hero--skeleton" data-testid={testId}>
      <div className="show-hero__body">
        <div className="poster poster--skeleton poster--hero show-hero__poster" />
        <div className="show-hero__info">
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line skeleton-line--sub" />
        </div>
      </div>
    </div>
  );
}
