import type { LibraryEntry } from "./library";
import type { MovieEntry } from "./movie-library";

export interface WatchTotals {
  readonly episodes: number;
  readonly shows: number;
  readonly movies: number;
  readonly minutes: number | null;
}

export function watchTotals(
  shows: readonly LibraryEntry[],
  movies: readonly MovieEntry[],
): WatchTotals {
  const watchedShows = shows.filter((show) => show.completed > 0);
  const watchedMovies = movies.filter((movie) => movie.watched);
  const timed = [
    ...watchedShows.map((show) => (show.runtime === null ? null : show.runtime * show.completed)),
    ...watchedMovies.map((movie) => movie.runtime),
  ].filter((minutes) => minutes !== null);
  return {
    episodes: watchedShows.reduce((total, show) => total + show.completed, 0),
    shows: watchedShows.length,
    movies: watchedMovies.length,
    minutes: timed.length === 0 ? null : timed.reduce((total, minutes) => total + minutes, 0),
  };
}
