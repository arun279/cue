import type { MovieIds } from "../../domain/model/ids";
import type { MovieDetailData, WatchedMovie, WatchlistItem } from "./schemas";

export interface MovieEntry {
  readonly movieId: number;
  readonly ids: MovieIds;
  readonly title: string;
  readonly year: number | null;
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly inWatchlist: boolean;
  readonly listedAt: string | null;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
}

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

export function toMovieIds(ids: {
  trakt: number;
  slug?: string;
  imdb?: string | null;
  tmdb?: number | null;
}): MovieIds {
  return {
    trakt: ids.trakt,
    slug: ids.slug,
    imdb: ids.imdb ?? undefined,
    tmdb: ids.tmdb ?? undefined,
  };
}

type SchemaMovie = NonNullable<WatchlistItem["movie"]>;

interface WatchlistMovie {
  readonly movie: SchemaMovie;
  readonly listedAt: string | null;
}

function toWatchedMovieEntry(
  watched: WatchedMovie,
  watchlist: WatchlistMovie | undefined,
): MovieEntry {
  const { movie } = watched;
  return {
    movieId: movie.ids.trakt,
    ids: toMovieIds(movie.ids),
    title: movie.title,
    year: movie.year ?? null,
    watched: true,
    watchedAt: watched.last_watched_at ?? null,
    inWatchlist: watchlist !== undefined,
    listedAt: watchlist?.listedAt ?? null,
    posters: movie.images?.poster ?? [],
    tmdbId: movie.ids.tmdb ?? null,
  };
}

function toWatchlistMovieEntry({ movie, listedAt }: WatchlistMovie): MovieEntry {
  return {
    movieId: movie.ids.trakt,
    ids: toMovieIds(movie.ids),
    title: movie.title,
    year: movie.year ?? null,
    watched: false,
    watchedAt: null,
    inWatchlist: true,
    listedAt,
    posters: movie.images?.poster ?? [],
    tmdbId: movie.ids.tmdb ?? null,
  };
}

export function assembleMovieLibrary(input: MovieLibraryInput): MovieEntry[] {
  const watchlistById = new Map<number, WatchlistMovie>();
  for (const item of input.watchlistMovies) {
    if (item.movie !== undefined && !watchlistById.has(item.movie.ids.trakt)) {
      watchlistById.set(item.movie.ids.trakt, {
        movie: item.movie,
        listedAt: item.listed_at ?? null,
      });
    }
  }

  const watchedIds = new Set(input.watchedMovies.map(({ movie }) => movie.ids.trakt));
  return [
    ...input.watchedMovies.map((watched) =>
      toWatchedMovieEntry(watched, watchlistById.get(watched.movie.ids.trakt)),
    ),
    ...[...watchlistById]
      .filter(([trakt]) => !watchedIds.has(trakt))
      .map(([, watchlist]) => toWatchlistMovieEntry(watchlist)),
  ];
}

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
