import { ErrorToast } from "@ui/components/ErrorStates";
import { useMovieDiscover } from "@ui/hooks/useMovieDiscover";
import { useWatchlistAdd } from "@ui/hooks/useWatchlistAdd";
import { DiscoverGrid } from "@ui/screens/search/DiscoverCard";
import type { ReactElement } from "react";

/**
 * The movie home's Discover zone: trending + popular movie rails below the user's
 * own Watchlist / Watched piles. This is what makes `/library?type=movies` a
 * complete *home* rather than a bare list — a movies-only user's sole tab now
 * offers a way to find something new, and an empty library becomes a place to
 * browse instead of a dead end. Every tile is the shared DiscoverCard idiom, so it
 * routes to `/movie/:id` and adds to the watchlist inline exactly like search.
 *
 * Quiet and additive (the Movie-detail related-rail precedent): while loading, on
 * a transient error, or when Trakt returns no rows, it renders nothing rather than
 * intruding on the library — the rails self-heal on the next visit's stale-window
 * refetch. The read is gated by `active` so a both-user on the Shows tab never
 * fires it.
 */
export function MovieDiscover({ active }: { readonly active: boolean }): ReactElement | null {
  const discover = useMovieDiscover(active);
  const watchlistAdd = useWatchlistAdd({ movies: true });

  const rails = [
    { testId: "movie-discover-trending", head: "Trending movies", hits: discover.trending },
    { testId: "movie-discover-popular", head: "Popular movies", hits: discover.popular },
  ].filter((rail) => rail.hits.length > 0);
  if (rails.length === 0) return null;

  return (
    <section className="movie-discover" data-testid="movie-discover">
      <h2 className="movie-discover__head">More to watch</h2>
      <div className="discover-browse">
        {rails.map((rail) => (
          <section key={rail.testId} className="discover-rail" data-testid={rail.testId}>
            <h3 className="discover-rail__head">{rail.head}</h3>
            <DiscoverGrid
              hits={rail.hits}
              tmdbConfig={discover.tmdbConfig}
              isAdded={watchlistAdd.isAdded}
              onAdd={(hit) => void watchlistAdd.add(hit)}
              testId={`${rail.testId}-grid`}
            />
          </section>
        ))}
      </div>
      {watchlistAdd.addError !== null && (
        <ErrorToast
          testId="movie-discover-add-error"
          message={watchlistAdd.addError}
          onDismiss={watchlistAdd.clearAddError}
        />
      )}
    </section>
  );
}
