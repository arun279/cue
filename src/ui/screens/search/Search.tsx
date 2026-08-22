import type { SearchHit } from "@data/trakt/search";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { PullToRefresh } from "@ui/components/PullToRefresh";
import { SectionHeader } from "@ui/components/SectionHeader";
import { SkeletonRows } from "@ui/components/Skeletons";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { middleTruncate } from "@ui/format";
import { useBrowse } from "@ui/hooks/useBrowse";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useIsOffline } from "@ui/hooks/useIsOffline";
import { type SearchView, useSearch, visibleSearchHits } from "@ui/hooks/useSearch";
import { usePrefs } from "@ui/prefs/prefs-store";
import { ArrowUpLeft } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect } from "react";
import { HitTile } from "./HitTile";
import { ResultRow } from "./ResultRow";
import { SearchField } from "./SearchField";

/** Each browse grid is a 3×3 sample: the catalog lives in search, not in a wall. */
const BROWSE_CELLS = 9;
const SKELETON_TILES = Array.from({ length: BROWSE_CELLS }, (_, index) => index);

function BrowseSkeleton(): ReactElement {
  return (
    <div className="search-grid-skeleton" aria-hidden="true" data-testid="browse-skeleton">
      {SKELETON_TILES.map((tile) => (
        <div key={tile} className="search-grid-skeleton__tile">
          <div className="search-grid-skeleton__art" />
          <div className="search-grid-skeleton__cap" />
        </div>
      ))}
    </div>
  );
}

/** Idle (empty query): session-recent searches as re-run rows, then the
 * trending-shows / popular-movies poster grids, not rails. */
function Browse({
  view,
  showsEnabled,
  moviesEnabled,
}: {
  readonly view: SearchView;
  readonly showsEnabled: boolean;
  readonly moviesEnabled: boolean;
}): ReactElement {
  const browse = useBrowse();
  // A single-medium user never sees the other medium's browse grid.
  const grids = [
    {
      key: "search-trending-shows",
      label: "Trending shows",
      hits: browse.trending,
      enabled: showsEnabled,
    },
    {
      key: "search-popular-movies",
      label: "Popular movies",
      hits: browse.popularMovies,
      enabled: moviesEnabled,
    },
  ].filter((grid) => grid.enabled);

  let rails: ReactNode;
  if (browse.isLoading) {
    rails = <BrowseSkeleton />;
  } else if (browse.isError) {
    rails = (
      <ErrorRetry
        title="Couldn't load browse"
        testId="browse-error"
        buttonTestId="browse-error-retry"
        onRetry={browse.refetch}
      />
    );
  } else {
    rails = grids
      .filter((grid) => grid.hits.length > 0)
      .map((grid) => (
        <section key={grid.key} className="search-rail" data-testid={grid.key}>
          <SectionHeader label={grid.label} />
          <div className="poster-tile-grid">
            {grid.hits.slice(0, BROWSE_CELLS).map((hit) => (
              <HitTile key={hit.key} hit={hit} />
            ))}
          </div>
        </section>
      ));
  }

  return (
    <div data-testid="search-browse">
      {view.recent.length > 0 && (
        <section className="search-rail" data-testid="search-recent">
          <SectionHeader label="Recent" />
          <ul className="row-list">
            {view.recent.map((term) => (
              <li key={term}>
                <button
                  type="button"
                  className="recent-row"
                  data-testid="search-recent-row"
                  onClick={() => view.setInput(term)}
                >
                  <span className="recent-row__term">{term}</span>
                  <ArrowUpLeft aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {rails}
    </div>
  );
}

/**
 * Search: one field over two honest states. Idle shows recent searches and a
 * small trending/popular browse sample; a settled query returns mixed
 * show/movie rows with a deterministic "+ Watchlist" add (undo via snackbar).
 * Every state is designed: shimmer rows in flight, a no-results line that
 * blames the spelling rather than the user, inline retry on failure, and an
 * offline panel. Search is the one surface that genuinely needs a connection.
 */
export function Search(): ReactElement {
  useDocumentTitle("Search · Cue");
  const view = useSearch();
  const offline = useIsOffline();
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  const visibleHits = visibleSearchHits(view.hits, showsEnabled, moviesEnabled);
  const placeholder =
    showsEnabled && moviesEnabled ? "Shows and movies…" : showsEnabled ? "Shows…" : "Movies…";

  const { addError, clearAddError } = view;
  useEffect(() => {
    if (addError !== null) {
      showSnack({
        message: addError,
        actions: [
          {
            label: "Dismiss",
            onPress: () => {
              clearAddError();
              dismissSnack();
            },
          },
        ],
      });
    }
  }, [addError, clearAddError]);

  const onAdd = (hit: SearchHit): void => {
    void view.add(hit);
    showSnack({
      message: (
        <>
          <strong>{middleTruncate(hit.title)}</strong> added to Watchlist
        </>
      ),
      actions: [
        {
          label: "Undo",
          testId: "snackbar-undo",
          onPress: () => {
            dismissSnack();
            void view.remove(hit);
          },
        },
      ],
    });
  };

  let body: ReactNode;
  if (offline && view.status !== "idle") {
    body = <EmptyState testId="search-offline" headline="Search needs a connection." />;
  } else if (view.status === "idle") {
    body = <Browse view={view} showsEnabled={showsEnabled} moviesEnabled={moviesEnabled} />;
  } else if (view.status === "searching") {
    body = (
      <>
        <p className="sr-only" role="status" data-testid="search-searching">
          Searching…
        </p>
        <SkeletonRows rows={6} testId="search-skeleton" />
      </>
    );
  } else if (view.status === "error") {
    body = (
      <ErrorRetry
        title="Search failed"
        testId="search-error"
        buttonTestId="search-error-retry"
        onRetry={view.refetch}
      />
    );
  } else if (view.status === "empty" || visibleHits.length === 0) {
    // A single-medium user whose query matched ONLY the hidden medium would
    // otherwise read a bare no-results: a search that looks broken rather than
    // settings-filtered. Name the hidden results and point to the fix instead.
    const hiddenCount = view.status === "empty" ? 0 : view.hits.length;
    const hiddenLabel = moviesEnabled ? "TV shows" : "Movies";
    body = (
      <EmptyState
        testId="search-no-results"
        headline={`Nothing for "${view.query}".`}
        body={
          hiddenCount > 0
            ? `${hiddenCount} ${hiddenCount === 1 ? "result is" : "results are"} hidden in ${hiddenLabel}. Turn ${hiddenLabel} on in Settings to see ${hiddenCount === 1 ? "it" : "them"}.`
            : "Check spelling or try the year."
        }
      />
    );
  } else {
    body = (
      <>
        <p className="sr-only" role="status" data-testid="search-result-count">
          {visibleHits.length} {visibleHits.length === 1 ? "result" : "results"} for "{view.query}"
        </p>
        <ul className="row-list" data-testid="search-results">
          {visibleHits.map((hit) => (
            <li key={hit.key}>
              <ResultRow hit={hit} added={view.isAdded(hit)} onAdd={onAdd} />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section className="screen-search" data-testid="screen-search">
      <ScreenHeader title="Search" variant="root" />
      <SearchField
        value={view.input}
        onChange={view.setInput}
        placeholder={placeholder}
        label={`Search ${showsEnabled && moviesEnabled ? "shows and movies" : showsEnabled ? "shows" : "movies"}`}
      />
      <PullToRefresh>{body}</PullToRefresh>
    </section>
  );
}
