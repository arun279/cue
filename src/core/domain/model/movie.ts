import type { MovieIds } from "./ids";

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
