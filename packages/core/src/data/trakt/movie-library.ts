import type { MovieIds } from "../../domain/model/ids";
import { laterOf } from "../../domain/time";
import type { CollectionMovie, MovieDetailData, WatchedMovie, WatchlistItem } from "./schemas";
import { artOf } from "./show-detail";

export interface MovieEntry {
  readonly movieId: number;
  readonly ids: MovieIds;
  readonly title: string;
  readonly year: number | null;
  readonly watched: boolean;
  readonly watchedAt: string | null;
  readonly inWatchlist: boolean;
  readonly inCollection: boolean;
  readonly addedAt: string | null;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
  readonly runtime: number | null;
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
  readonly collectionMovies: readonly CollectionMovie[];
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

interface Saved {
  readonly movie: SchemaMovie;
  readonly addedAt: string | null;
  readonly inWatchlist: boolean;
  readonly inCollection: boolean;
}

function savedMovies(input: MovieLibraryInput): Map<number, Saved> {
  const saved = new Map<number, Saved>();
  const add = (movie: SchemaMovie | undefined, addedAt: string | null, watchlist: boolean) => {
    if (movie === undefined) return;
    const known = saved.get(movie.ids.trakt) ?? {
      movie,
      addedAt: null,
      inWatchlist: false,
      inCollection: false,
    };
    saved.set(movie.ids.trakt, {
      movie: known.movie,
      addedAt: laterOf(known.addedAt, addedAt),
      inWatchlist: known.inWatchlist || watchlist,
      inCollection: known.inCollection || !watchlist,
    });
  };
  for (const item of input.watchlistMovies) add(item.movie, item.listed_at ?? null, true);
  for (const item of input.collectionMovies) add(item.movie, item.collected_at ?? null, false);
  return saved;
}

function savedFields(
  saved: Saved | undefined,
): Pick<MovieEntry, "inWatchlist" | "inCollection" | "addedAt"> {
  if (saved === undefined) return { inWatchlist: false, inCollection: false, addedAt: null };
  return {
    inWatchlist: saved.inWatchlist,
    inCollection: saved.inCollection,
    addedAt: saved.addedAt,
  };
}

function toMovieEntry(
  movie: SchemaMovie & { readonly runtime?: number | null },
  watched: WatchedMovie | undefined,
  saved: Saved | undefined,
): MovieEntry {
  return {
    movieId: movie.ids.trakt,
    ids: toMovieIds(movie.ids),
    title: movie.title,
    year: movie.year ?? null,
    watched: watched !== undefined,
    watchedAt: watched?.last_watched_at ?? null,
    ...savedFields(saved),
    posters: movie.images?.poster ?? [],
    tmdbId: movie.ids.tmdb ?? null,
    runtime: movie.runtime ?? null,
  };
}

export function assembleMovieLibrary(input: MovieLibraryInput): MovieEntry[] {
  const saved = savedMovies(input);
  const watchedIds = new Set(input.watchedMovies.map(({ movie }) => movie.ids.trakt));
  return [
    ...input.watchedMovies.map((watched) =>
      toMovieEntry(watched.movie, watched, saved.get(watched.movie.ids.trakt)),
    ),
    ...[...saved]
      .filter(([trakt]) => !watchedIds.has(trakt))
      .map(([, entry]) => toMovieEntry(entry.movie, undefined, entry)),
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
    ...artOf(movie.images),
    tmdbId: movie.ids.tmdb ?? null,
  };
}
