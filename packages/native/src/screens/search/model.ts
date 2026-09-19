import type { SearchHit } from "@cue/core/data/trakt/search";
import type { BrowseData } from "@cue/core/runtime/runtime";

export const BROWSE_CELLS = 9;

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

export function noResultsBody(hidden: number, moviesEnabled: boolean): string {
  if (hidden === 0) return "Check spelling or try the year.";
  const medium = moviesEnabled ? "TV shows" : "Movies";
  const subject = hidden === 1 ? "result is" : "results are";
  return `${hidden} ${subject} hidden in ${medium}. Turn ${medium} on in Settings to see ${hidden === 1 ? "it" : "them"}.`;
}
