import type { UserStats } from "@data/trakt/schemas";
import type { MediaVisibility } from "@ui/prefs/media-visibility";

interface CountTile {
  readonly key: string;
  readonly testId: string;
  readonly label: string;
  readonly value: number;
  readonly medium: "tv" | "movies";
}

/** The count tiles for the enabled media, in the canonical order (Episodes /
 * Movies / Shows). A single-medium user sees only their medium's tiles;
 * the honesty rule is that watch-time and tiles move together: never a Movies tile
 * hidden while its minutes still swell the total (or vice-versa). */
export function countTiles(
  stats: UserStats,
  { showsEnabled, moviesEnabled }: MediaVisibility,
): CountTile[] {
  const tiles: CountTile[] = [
    {
      key: "episodes",
      testId: "stat-episodes",
      label: "Episodes",
      value: stats.episodes.watched,
      medium: "tv",
    },
    {
      key: "movies",
      testId: "stat-movies",
      label: "Movies",
      value: stats.movies.watched,
      medium: "movies",
    },
    {
      key: "shows",
      testId: "stat-shows",
      label: "Shows",
      value: stats.shows.watched,
      medium: "tv",
    },
  ];
  return tiles.filter((tile) => (tile.medium === "movies" ? moviesEnabled : showsEnabled));
}

/** Total watch time counts only the enabled media, so the hero figure and the
 * tiles below it always describe the same thing. */
export function watchTimeMinutes(
  stats: UserStats,
  { showsEnabled, moviesEnabled }: MediaVisibility,
): number {
  return (showsEnabled ? stats.episodes.minutes : 0) + (moviesEnabled ? stats.movies.minutes : 0);
}

/** Empty over the enabled media only: a movies-only user with zero movies gets the
 * empty state even if they have (now-hidden) TV history, and vice-versa. */
export function isAllZero(
  stats: UserStats,
  { showsEnabled, moviesEnabled }: MediaVisibility,
): boolean {
  const tvZero = stats.episodes.watched === 0 && stats.shows.watched === 0;
  const moviesZero = stats.movies.watched === 0;
  return (!showsEnabled || tvZero) && (!moviesEnabled || moviesZero);
}
