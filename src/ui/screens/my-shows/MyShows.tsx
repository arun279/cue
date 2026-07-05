import type { LibraryEntry } from "@data/trakt/library";
import type { LibrarySort } from "@domain/library-buckets";
import type { WatchStatus } from "@domain/watch-status";
import { VirtualList } from "@ui/components/VirtualList";
import { type LibraryBucketView, useLibraryBuckets } from "@ui/hooks/useLibraryBuckets";
import { ToggleGroup } from "radix-ui";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { ShowRow } from "./ShowRow";

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

type LibraryRow =
  | { readonly kind: "header"; readonly status: WatchStatus; readonly count: number }
  | { readonly kind: "show"; readonly entry: LibraryEntry };

function flatten(buckets: readonly LibraryBucketView[]): LibraryRow[] {
  const rows: LibraryRow[] = [];
  for (const bucket of buckets) {
    rows.push({ kind: "header", status: bucket.status, count: bucket.entries.length });
    for (const entry of bucket.entries) rows.push({ kind: "show", entry });
  }
  return rows;
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

function Skeleton(): ReactElement {
  return (
    <div
      className="library-list library-list--skeleton"
      aria-hidden="true"
      data-testid="my-shows-skeleton"
    >
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="library-card library-card--skeleton">
          <div className="poster poster--skeleton" />
          <div className="library-card__body">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--sub" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * My Shows — the whole library grouped into aired-based status buckets,
 * virtualized so a large library stays smooth (few DOM rows). A Shows⇄Movies
 * segmented toggle switches library type (Movies), and a sort control
 * reorders within every bucket. Every state is designed: skeleton, hard error,
 * cached-error banner, whole-library empty, per-type empty.
 */
export function MyShows(): ReactElement {
  const [sort, setSort] = useState<LibrarySort>("recently-watched");
  const [libraryType, setLibraryType] = useState<"shows" | "movies">("shows");
  const view = useLibraryBuckets(sort);
  const rows = useMemo(() => flatten(view.buckets), [view.buckets]);

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
      <VirtualList
        items={rows}
        estimateSize={84}
        label="Library grouped by status"
        className="library-list"
        renderItem={(row) =>
          row.kind === "header" ? (
            <h2 className="library-heading" data-testid="bucket-heading" data-status={row.status}>
              {STATUS_LABEL[row.status]}
              <span className="library-heading__count">{row.count}</span>
            </h2>
          ) : (
            <ShowRow entry={row.entry} tmdbConfig={view.tmdbConfig} />
          )
        }
      />
    );
  }

  return (
    <section className="screen screen--full" data-testid="screen-my-shows">
      <header className="screen__head">
        <h1 className="screen__title">My Shows</h1>
        <p
          className="status-pill"
          role="status"
          data-testid="my-shows-status"
          data-state={view.isFetching ? "syncing" : view.isError ? "offline" : "synced"}
        >
          {view.isFetching ? "Syncing…" : view.isError ? "Offline" : "Synced"}
        </p>
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
        <div className="banner banner--warn" role="alert" data-testid="my-shows-cached-retry">
          <span>Showing your last synced library — Trakt couldn't be reached.</span>
          <button
            type="button"
            className="button button--ghost button--sm"
            data-testid="my-shows-cached-retry-button"
            onClick={view.refetch}
          >
            Retry
          </button>
        </div>
      )}

      {body}
    </section>
  );
}
