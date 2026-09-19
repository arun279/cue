import type { SearchHit } from "@cue/core/data/trakt/search";
import type { BrowseData } from "@cue/core/runtime/runtime";

/** Each browse grid is a 3x3 sample: the catalog lives in search, not in a wall. */
export const BROWSE_CELLS = 9;

/** How a hit names its medium, in the result badge and in every composed label. */
export const MEDIUM: Readonly<Record<SearchHit["type"], string>> = {
  show: "Show",
  movie: "Movie",
};

export const routeOf = (hit: SearchHit): `/show/${number}` | `/movie/${number}` =>
  hit.type === "movie" ? `/movie/${hit.traktId}` : `/show/${hit.traktId}`;

export const labelOf = (hit: SearchHit): string =>
  [hit.title, MEDIUM[hit.type], hit.year].filter((part) => part !== null).join(", ");

export interface BrowseGrid {
  readonly key: string;
  readonly label: string;
  readonly hits: readonly SearchHit[];
}

/**
 * The browse grids this reader gets: one per enabled medium, and a grid with
 * nothing in it dropped entirely rather than drawn with a heading over a gap.
 */
export function browseGrids(
  browse: BrowseData | undefined,
  showsEnabled: boolean,
  moviesEnabled: boolean,
): readonly BrowseGrid[] {
  return [
    { label: "Trending shows", hits: browse?.trending ?? [], enabled: showsEnabled },
    { label: "Popular movies", hits: browse?.popularMovies ?? [], enabled: moviesEnabled },
  ]
    .filter((grid) => grid.enabled && grid.hits.length > 0)
    .map((grid) => ({
      key: grid.label,
      label: grid.label,
      hits: grid.hits.slice(0, BROWSE_CELLS),
    }));
}

export const placeholderFor = (showsEnabled: boolean, moviesEnabled: boolean): string =>
  showsEnabled && moviesEnabled ? "Shows and movies…" : showsEnabled ? "Shows…" : "Movies…";

/**
 * Why a settled query returned nothing. A reader with one medium off whose query
 * matched only the hidden one would otherwise read a bare no-results, a search
 * that looks broken rather than one filtered by a switch two screens away, so
 * the count is named and so is the switch that reveals it.
 */
export function noResultsBody(hidden: number, moviesEnabled: boolean): string {
  if (hidden === 0) return "Check spelling or try the year.";
  const medium = moviesEnabled ? "TV shows" : "Movies";
  const subject = hidden === 1 ? "result is" : "results are";
  return `${hidden} ${subject} hidden in ${medium}. Turn ${medium} on in Settings to see ${hidden === 1 ? "it" : "them"}.`;
}
