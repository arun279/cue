import type { ReactElement } from "react";

const SKELETON_SHELVES = [0, 1];
const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7];

/** The My Shows loading silhouette: two shelves of poster tiles, matching the
 * final shelf-wall layout so there is no shift on load (Rams 8). Shared by the
 * show buckets and the movie shelves. */
export function LibrarySkeleton({ testId }: { readonly testId: string }): ReactElement {
  return (
    <div className="library" aria-hidden="true" data-testid={testId}>
      {SKELETON_SHELVES.map((shelf) => (
        <section key={shelf} className="library-section">
          <div className="library-heading library-heading--skeleton">
            <span className="skeleton-line skeleton-line--heading" />
          </div>
          <div className="poster-grid poster-grid--static">
            {SKELETON_TILES.map((tile) => (
              <div key={tile} className="poster-grid__cell">
                <div className="poster-card poster-card--skeleton">
                  <div className="poster poster--tile poster--skeleton" />
                  <div className="poster-card__meta">
                    <div className="skeleton-line skeleton-line--title" />
                    <div className="skeleton-line skeleton-line--sub" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
