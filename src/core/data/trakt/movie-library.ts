import type { MovieIds } from "../../domain/model/ids";
import { type MovieEntry, type MovieHeader, unwatchedMovie } from "../../domain/model/movie";
import { laterOf } from "../../domain/time";
import type { CollectionMovie, MovieDetailData, WatchedMovie, WatchlistItem } from "./schemas";
import { artOf } from "./show-detail";

export interface MovieLibraryInput {
  readonly watchedMovies: readonly WatchedMovie[];
  readonly watchlist: readonly MovieEntry[];
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

type SchemaMovie = NonNullable<WatchlistItem["movie"]> & { readonly runtime?: number | null };

type MovieMedia = Pick<
  MovieEntry,
  "movieId" | "ids" | "title" | "year" | "posters" | "tmdbId" | "runtime"
>;

interface Saved {
  readonly media: MovieMedia;
  readonly addedAt: string | null;
  readonly inWatchlist: boolean;
  readonly inCollection: boolean;
}

function mediaOf(movie: SchemaMovie): MovieMedia {
  return {
    movieId: movie.ids.trakt,
    ids: toMovieIds(movie.ids),
    title: movie.title,
    year: movie.year ?? null,
    posters: movie.images?.poster ?? [],
    tmdbId: movie.ids.tmdb ?? null,
    runtime: movie.runtime ?? null,
  };
}

function save(
  saved: Map<number, Saved>,
  media: MovieMedia,
  addedAt: string | null,
  watchlist: boolean,
): void {
  const known = saved.get(media.movieId) ?? {
    media,
    addedAt: null,
    inWatchlist: false,
    inCollection: false,
  };
  saved.set(media.movieId, {
    media: known.media,
    addedAt: laterOf(known.addedAt, addedAt),
    inWatchlist: known.inWatchlist || watchlist,
    inCollection: known.inCollection || !watchlist,
  });
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
  media: MovieMedia,
  watched: WatchedMovie | undefined,
  saved: Saved | undefined,
): MovieEntry {
  const entry = unwatchedMovie({
    movieId: media.movieId,
    ids: media.ids,
    title: media.title,
    year: media.year,
    ...savedFields(saved),
    posters: media.posters,
    tmdbId: media.tmdbId,
    runtime: media.runtime,
  });
  return watched === undefined
    ? entry
    : { ...entry, watched: true, watchedAt: watched.last_watched_at ?? null };
}

function toMovieEntries(
  watchedMovies: readonly WatchedMovie[],
  saved: ReadonlyMap<number, Saved>,
): MovieEntry[] {
  const watchedIds = new Set(watchedMovies.map(({ movie }) => movie.ids.trakt));
  return [
    ...watchedMovies.map((watched) =>
      toMovieEntry(mediaOf(watched.movie), watched, saved.get(watched.movie.ids.trakt)),
    ),
    ...[...saved]
      .filter(([trakt]) => !watchedIds.has(trakt))
      .map(([, entry]) => toMovieEntry(entry.media, undefined, entry)),
  ];
}

export function assembleMovieWatchlist(rows: readonly WatchlistItem[]): MovieEntry[] {
  const saved = new Map<number, Saved>();
  for (const row of rows) {
    if (row.movie !== undefined) save(saved, mediaOf(row.movie), row.listed_at ?? null, true);
  }
  return toMovieEntries([], saved);
}

export function assembleMovieLibrary(input: MovieLibraryInput): MovieEntry[] {
  const saved = new Map<number, Saved>();
  for (const entry of input.watchlist) save(saved, entry, entry.addedAt, true);
  for (const item of input.collectionMovies) {
    save(saved, mediaOf(item.movie), item.collected_at ?? null, false);
  }
  return toMovieEntries(input.watchedMovies, saved);
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
