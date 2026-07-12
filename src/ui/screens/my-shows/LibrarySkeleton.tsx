import type { ReactElement } from "react";

const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** The Library loading silhouette: nine shimmering poster tiles matching the
 * final 3-column grid, so there is no shift on load. */
export function LibrarySkeleton({ testId }: { readonly testId: string }): ReactElement {
  return (
    <div className="library-skeleton" aria-hidden="true" data-testid={testId}>
      {SKELETON_TILES.map((tile) => (
        <div key={tile} className="library-skeleton__tile">
          <div className="library-skeleton__art" />
          <div className="library-skeleton__cap" />
        </div>
      ))}
    </div>
  );
}
