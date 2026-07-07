import type { SearchHit } from "@data/trakt/search";
import { useBrowse } from "@ui/hooks/useBrowse";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { type SearchView, useSearch } from "@ui/hooks/useSearch";
import { usePrefs } from "@ui/prefs/prefs-store";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { type ReactElement, type ReactNode, useId } from "react";
import { DiscoverGrid } from "./DiscoverCard";

const SKELETON_TILES = [0, 1, 2, 3, 4, 5];

function RailSkeleton(): ReactElement {
  return (
    <div className="poster-grid--static" aria-hidden="true" data-testid="discover-skeleton">
      {SKELETON_TILES.map((tile) => (
        <div key={tile} className="discover-card discover-card--skeleton">
          <div className="poster poster--tile poster--skeleton" />
          <div className="discover-card__meta">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--sub" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Empty-query browse: trending + popular poster rails for shows AND movies, with
 * recent searches as quick re-run chips above them. Every rail state is designed
 * (skeleton, error retry, real posters); each rail is the same poster idiom, so
 * movie hits route to `/movie/:id` and add inline exactly like the show rails. */
function Browse({ view }: { view: SearchView }): ReactElement {
  const browse = useBrowse();
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  // A single-medium user never sees the other medium's discover rails.
  const rows: readonly {
    readonly testId: string;
    readonly head: string;
    readonly hits: readonly SearchHit[];
    readonly enabled: boolean;
  }[] = [
    {
      testId: "discover-trending",
      head: "Trending shows",
      hits: browse.trending,
      enabled: showsEnabled,
    },
    {
      testId: "discover-popular",
      head: "Popular shows",
      hits: browse.popular,
      enabled: showsEnabled,
    },
    {
      testId: "discover-trending-movies",
      head: "Trending movies",
      hits: browse.trendingMovies,
      enabled: moviesEnabled,
    },
    {
      testId: "discover-popular-movies",
      head: "Popular movies",
      hits: browse.popularMovies,
      enabled: moviesEnabled,
    },
  ].filter((row) => row.enabled);
  const anyRail = rows.some((row) => row.hits.length > 0);

  let rails: ReactNode;
  if (browse.isLoading) {
    rails = (
      <>
        <RailSkeleton />
        <RailSkeleton />
      </>
    );
  } else if (browse.isError) {
    rails = (
      <div className="empty" data-testid="discover-error">
        <h2 className="empty__title">Couldn't load browse</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="discover-error-retry"
          onClick={browse.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (!anyRail) {
    rails = (
      <div className="empty" data-testid="discover-empty">
        <h2 className="empty__title">Find something to watch</h2>
        <p className="empty__body">Search any show or movie by name to add it to your watchlist.</p>
      </div>
    );
  } else {
    rails = rows
      .filter((row) => row.hits.length > 0)
      .map((row) => (
        <section key={row.testId} className="discover-rail" data-testid={row.testId}>
          <h2 className="discover-rail__head">{row.head}</h2>
          <DiscoverGrid
            hits={row.hits}
            tmdbConfig={browse.tmdbConfig}
            isAdded={view.isAdded}
            onAdd={(hit) => void view.add(hit)}
            testId={`${row.testId}-grid`}
          />
        </section>
      ));
  }

  return (
    <div className="discover-browse" data-testid="search-prequery">
      {view.recent.length > 0 && (
        <div className="search-recent" data-testid="search-recent">
          <p className="search-recent__label">Recent searches</p>
          <ul className="search-recent__list">
            {view.recent.map((term) => (
              <li key={term}>
                <button
                  type="button"
                  className="badge search-recent__chip"
                  data-testid="search-recent-chip"
                  onClick={() => view.setInput(term)}
                >
                  {term}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rails}
    </div>
  );
}

/**
 * Discover — a poster-forward browse + search screen. Empty query
 * shows trending + popular poster rails; a debounced query returns a title-ranked
 * poster grid of real results, each tile linking to its Show page with an inline
 * watchlist add. Every state is designed: browse skeleton/error, in-flight,
 * title-ranked results with a count, a no-results empty state, and a hard-error
 * retry.
 */
export function Search(): ReactElement {
  useDocumentTitle("Search · Cue");
  const view = useSearch();
  const inputId = useId();
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  // A single-medium user never sees the other medium as a result tile
  // (which would be a live entry point into a hidden section).
  const visibleHits = view.hits.filter((hit) =>
    hit.type === "movie" ? moviesEnabled : showsEnabled,
  );
  const mediumWord =
    showsEnabled && moviesEnabled ? "shows and movies" : showsEnabled ? "shows" : "movies";

  let body: ReactNode;
  if (view.status === "idle") {
    body = <Browse view={view} />;
  } else if (view.status === "searching") {
    body = (
      <p className="search-status" role="status" data-testid="search-searching">
        Searching…
      </p>
    );
  } else if (view.status === "error") {
    body = (
      <div className="empty" data-testid="search-error">
        <h2 className="empty__title">Search failed</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="search-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.status === "empty" || visibleHits.length === 0) {
    body = (
      <div className="empty" data-testid="search-no-results">
        <h2 className="empty__title">No matches for "{view.query}"</h2>
        <p className="empty__body">Try a different title or check the spelling.</p>
      </div>
    );
  } else {
    body = (
      <div className="discover-results">
        <p className="discover-results__count" role="status" data-testid="search-result-count">
          {visibleHits.length} {visibleHits.length === 1 ? "result" : "results"} for "{view.query}"
        </p>
        <DiscoverGrid
          hits={visibleHits}
          tmdbConfig={null}
          isAdded={view.isAdded}
          onAdd={(hit) => void view.add(hit)}
          testId="search-results"
        />
      </div>
    );
  }

  return (
    <section className="screen screen--discover" data-testid="screen-search">
      <header className="screen__head">
        <h1 className="screen__title">Search</h1>
      </header>

      <search className="discover-search">
        <label className="discover-search__label" htmlFor={inputId}>
          Search {mediumWord}
        </label>
        <div className="discover-search__field">
          <svg className="discover-search__icon" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M9 3a6 6 0 1 0 3.7 10.7l3.3 3.3 1.4-1.4-3.3-3.3A6 6 0 0 0 9 3Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
              fill="currentColor"
            />
          </svg>
          <input
            id={inputId}
            type="search"
            className="discover-search__input"
            data-testid="search-input"
            placeholder={`Search ${mediumWord}…`}
            autoComplete="off"
            value={view.input}
            onChange={(event) => view.setInput(event.target.value)}
          />
        </div>
      </search>

      {body}

      {view.addError !== null && (
        <Snackbar
          testId="search-add-error"
          message={view.addError}
          actionLabel="Dismiss"
          onAction={view.clearAddError}
          onDismiss={view.clearAddError}
        />
      )}
    </section>
  );
}
