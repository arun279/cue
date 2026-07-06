import type { MovieEntry } from "@data/trakt/movie-library";
import type { MovieLibraryView } from "@ui/hooks/useMovieLibrary";
import type { ReactElement } from "react";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { MoviePosterCard } from "./MoviePosterCard";
import { PosterGrid } from "./PosterGrid";

/**
 * The My Shows Movies tab: the watched + watchlist movie
 * library as two poster shelves (Watched / Watchlist), each a window-virtualized
 * grid of 2:3 tiles that route to Movie detail. Every state is designed:
 * skeleton, hard error retry, and a whole-library empty state. A shelf with no
 * movies is omitted so the tab never shows an empty header.
 */
export function MoviesLibrary({ view }: { readonly view: MovieLibraryView }): ReactElement {
  if (view.isLoading) return <LibrarySkeleton testId="movies-skeleton" />;

  if (view.isError && !view.hasData) {
    return (
      <div className="empty" data-testid="movies-error">
        <h2 className="empty__title">Couldn't load your movies</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="movies-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  }

  if (view.trackedCount === 0) {
    return (
      <div className="empty" data-testid="movies-empty">
        <h2 className="empty__title">No movies yet</h2>
        <p className="empty__body">
          Mark a movie watched or add one to your watchlist and it'll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="library">
      {view.shelves.map((shelf) =>
        shelf.entries.length === 0 ? null : (
          <section key={shelf.key} className="library-section">
            <h2
              className="library-heading"
              data-testid="movie-shelf-heading"
              data-shelf={shelf.key}
            >
              {shelf.label}
              <span className="library-heading__count">{shelf.entries.length}</span>
            </h2>
            <PosterGrid
              entries={shelf.entries}
              keyOf={(movie: MovieEntry) => movie.movieId}
              renderCell={(movie: MovieEntry) => (
                <MoviePosterCard entry={movie} tmdbConfig={view.tmdbConfig} />
              )}
            />
          </section>
        ),
      )}
    </div>
  );
}
