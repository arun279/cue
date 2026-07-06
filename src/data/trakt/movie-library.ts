import type { MovieIds } from "@domain/model/ids";
import type { MovieDetailData, WatchedMovie, WatchlistItem } from "./schemas";

/**
 * One movie in the My Shows movie library: merged from `/sync/watched/movies`
 * (watched + `watchedAt`) and `/sync/watchlist/movies` (membership). Unlike a
 * show there is no per-episode progress — a movie is watched or not — so the
 * shelf card renders a poster, title, year and its watched/watchlist state.
 */
export interface MovieEntry {
  readonly movieId: number;
  readonly ids: MovieIds;
  readonly title: string;
  readonly year: number | null;
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly inWatchlist: boolean;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
}

/** The Movie detail hero model, sourced from `/movies/:id?extended=full,images`. */
export interface MovieHeader {
  readonly movieId: number;
  readonly ids: MovieIds;
  readonly title: string;
  readonly year: number | null;
  readonly overview: string | null;
  readonly runtime: number | null;
  readonly released: string | null;
  readonly genres: readonly string[];
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
  readonly tmdbId: number | null;
}

export interface MovieLibraryInput {
  readonly watchedMovies: readonly WatchedMovie[];
  readonly watchlistMovies: readonly WatchlistItem[];
}

function toMovieIds(ids: MovieDetailData["ids"]): MovieIds {
  return {
    trakt: ids.trakt,
    slug: ids.slug,
    imdb: ids.imdb ?? undefined,
    tmdb: ids.tmdb ?? undefined,
  };
}

/**
 * Merge watched movies with the movie watchlist into the `MovieEntry[]` the My
 * Shows movie shelves and the Movie detail flags derive from. A watchlisted
 * movie that has never been watched has no `/sync/watched/movies` row, so it is
 * materialized here as an unwatched, watchlist-only entry (mirroring the show
 * library's watchlist-only handling) — otherwise it would vanish from the
 * Watchlist shelf after a refetch.
 */
export function assembleMovieLibrary(input: MovieLibraryInput): MovieEntry[] {
  const watchlistIds = new Set<number>();
  for (const item of input.watchlistMovies) {
    if (item.movie !== undefined) watchlistIds.add(item.movie.ids.trakt);
  }

  const entries: MovieEntry[] = [];
  const seen = new Set<number>();
  for (const watched of input.watchedMovies) {
    const { movie } = watched;
    const trakt = movie.ids.trakt;
    seen.add(trakt);
    entries.push({
      movieId: trakt,
      ids: toMovieIds(movie.ids),
      title: movie.title,
      year: movie.year ?? null,
      watched: true,
      watchedAt: watched.last_watched_at ?? null,
      inWatchlist: watchlistIds.has(trakt),
      posters: movie.images?.poster ?? [],
      tmdbId: movie.ids.tmdb ?? null,
    });
  }

  for (const item of input.watchlistMovies) {
    const movie = item.movie;
    if (movie === undefined || seen.has(movie.ids.trakt)) continue;
    seen.add(movie.ids.trakt);
    entries.push({
      movieId: movie.ids.trakt,
      ids: toMovieIds(movie.ids),
      title: movie.title,
      year: movie.year ?? null,
      watched: false,
      watchedAt: null,
      inWatchlist: true,
      posters: movie.images?.poster ?? [],
      tmdbId: movie.ids.tmdb ?? null,
    });
  }
  return entries;
}

/** Map the extended movie payload to the Movie detail hero model. */
export function assembleMovieHeader(movie: MovieDetailData): MovieHeader {
  return {
    movieId: movie.ids.trakt,
    ids: toMovieIds(movie.ids),
    title: movie.title,
    year: movie.year ?? null,
    overview: movie.overview ?? null,
    runtime: movie.runtime ?? null,
    released: movie.released ?? null,
    genres: movie.genres ?? [],
    posters: movie.images?.poster ?? [],
    backdrops: movie.images?.fanart ?? [],
    tmdbId: movie.ids.tmdb ?? null,
  };
}
