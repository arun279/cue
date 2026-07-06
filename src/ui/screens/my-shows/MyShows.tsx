import type { LibraryEntry } from "@data/trakt/library";
import type { LibrarySort } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { CachedRetryBanner } from "@ui/components/CachedRetryBanner";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useLibraryBuckets } from "@ui/hooks/useLibraryBuckets";
import { useMovieLibrary } from "@ui/hooks/useMovieLibrary";
import { ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useState } from "react";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { MoviesLibrary } from "./MoviesLibrary";
import { PosterCard } from "./PosterCard";
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

/**
 * My Shows — the whole library as a poster-forward shelf wall. A
 * Shows⇄Movies segmented toggle switches library type: shows group into
 * aired-based status buckets reordered by a sort control; movies split into
 * Watched / Watchlist shelves. Each shelf is a horizontal, virtualized grid of
 * 2:3 poster tiles routing to the Show or Movie page. Every state is designed:
 * skeleton, hard error, cached-error banner, whole-library empty.
 */
export function MyShows(): ReactElement {
  const [sort, setSort] = useState<LibrarySort>("recently-watched");
  const [libraryType, setLibraryType] = useState<"shows" | "movies">("shows");
  const view = useLibraryBuckets(sort);
  const movieView = useMovieLibrary();
  const active = libraryType === "movies" ? movieView : view;

  let body: ReactNode;
  if (libraryType === "movies") {
    body = <MoviesLibrary view={movieView} />;
  } else if (view.isLoading) {
    body = <LibrarySkeleton testId="my-shows-skeleton" />;
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
            <PosterGrid
              entries={bucket.entries}
              keyOf={(entry: LibraryEntry) => entry.showId}
              renderCell={(entry: LibraryEntry) => (
                <PosterCard entry={entry} tmdbConfig={view.tmdbConfig} />
              )}
            />
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
          isFetching={active.isFetching}
          isError={active.isError}
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

        {libraryType === "shows" && (
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
        )}
      </div>

      {active.isError && active.hasData && (
        <CachedRetryBanner
          testId="my-shows-cached-retry"
          buttonTestId="my-shows-cached-retry-button"
          message="Showing your last synced library — Trakt couldn't be reached."
          onRetry={active.refetch}
        />
      )}

      {body}
    </section>
  );
}
