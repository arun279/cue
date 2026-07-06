import type { LibrarySort } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { CachedRetryBanner } from "@ui/components/CachedRetryBanner";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useLibraryBuckets } from "@ui/hooks/useLibraryBuckets";
import { ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useState } from "react";
import { PosterGrid } from "./PosterGrid";

const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: "Watching",
  "coming-soon": "Coming soon",
  "up-to-date": "Up to date",
  ended: "Ended",
  "to-watch": "To watch",
  "not-started": "Not started",
  stopped: "Stopped",
};

const SORT_LABEL: Record<LibrarySort, string> = {
  "recently-watched": "Recently watched",
  alphabetical: "A–Z",
  progress: "Progress",
};

const SORTS: readonly LibrarySort[] = ["recently-watched", "alphabetical", "progress"];

const SKELETON_SHELVES = [0, 1];
const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7];

function Skeleton(): ReactElement {
  return (
    <div className="library" aria-hidden="true" data-testid="my-shows-skeleton">
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

/**
 * My Shows — the whole library as a poster-forward shelf wall. Each
 * aired-based status bucket becomes a horizontal, virtualized shelf of 2:3
 * poster tiles, so a large library scrolls smoothly and every tile routes to the
 * Show page. A Shows⇄Movies segmented toggle switches library type (Movies), and a sort control reorders within every bucket. Every state is
 * designed: skeleton, hard error, cached-error banner, whole-library empty.
 */
export function MyShows(): ReactElement {
  const [sort, setSort] = useState<LibrarySort>("recently-watched");
  const [libraryType, setLibraryType] = useState<"shows" | "movies">("shows");
  const view = useLibraryBuckets(sort);

  let body: ReactNode;
  if (libraryType === "movies") {
    body = (
      <div className="empty" data-testid="movies-placeholder">
        <h2 className="empty__title">Movies are coming soon</h2>
        <p className="empty__body">
          Your movie library will live here. For now, switch back to Shows.
        </p>
      </div>
    );
  } else if (view.isLoading) {
    body = <Skeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <div className="empty" data-testid="my-shows-error">
        <h2 className="empty__title">Couldn't load your library</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="my-shows-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.trackedCount === 0) {
    body = (
      <div className="empty" data-testid="my-shows-empty">
        <h2 className="empty__title">Nothing tracked yet</h2>
        <p className="empty__body">
          Follow a show and mark an episode watched — it'll show up here, grouped by where you are.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="library">
        {view.buckets.map((bucket) => (
          <section key={bucket.status} className="library-section">
            <h2
              className="library-heading"
              data-testid="bucket-heading"
              data-status={bucket.status}
            >
              {STATUS_LABEL[bucket.status]}
              <span className="library-heading__count">{bucket.entries.length}</span>
            </h2>
            <PosterGrid entries={bucket.entries} tmdbConfig={view.tmdbConfig} />
          </section>
        ))}
      </div>
    );
  }

  return (
    <section className="screen screen--library" data-testid="screen-my-shows">
      <header className="screen__head">
        <h1 className="screen__title">My Shows</h1>
        <SyncStatusPill
          testId="my-shows-status"
          isFetching={view.isFetching}
          isError={view.isError}
        />
      </header>

      <div className="library-controls">
        <ToggleGroup.Root
          type="single"
          className="segmented"
          aria-label="Library type"
          value={libraryType}
          onValueChange={(value) => {
            if (value === "shows" || value === "movies") setLibraryType(value);
          }}
        >
          <ToggleGroup.Item className="segmented__item" value="shows" data-testid="type-shows">
            Shows
          </ToggleGroup.Item>
          <ToggleGroup.Item className="segmented__item" value="movies" data-testid="type-movies">
            Movies
          </ToggleGroup.Item>
        </ToggleGroup.Root>

        <label className="library-sort">
          <span className="library-sort__label">Sort</span>
          <select
            className="library-sort__select"
            data-testid="sort-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
          >
            {SORTS.map((option) => (
              <option key={option} value={option}>
                {SORT_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {view.isError && view.hasData && libraryType === "shows" && (
        <CachedRetryBanner
          testId="my-shows-cached-retry"
          buttonTestId="my-shows-cached-retry-button"
          message="Showing your last synced library — Trakt couldn't be reached."
          onRetry={view.refetch}
        />
      )}

      {body}
    </section>
  );
}
