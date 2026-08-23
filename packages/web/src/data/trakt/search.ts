import type { MovieIds, ShowIds } from "@domain/model/ids";
import type { MovieSummary, SearchResult, ShowSummary } from "./schemas";

/** A show/movie search hit, flattened for the result row + inline watchlist add. */
export interface SearchHit {
  /** `${type}:${trakt}`: stable React key + dedupe handle. */
  readonly key: string;
  readonly type: "show" | "movie";
  readonly traktId: number;
  readonly title: string;
  readonly year: number | null;
  readonly posters: readonly string[];
  readonly tmdbId: number | null;
  readonly ids: ShowIds | MovieIds;
}

type SchemaShow = NonNullable<SearchResult["show"]>;
type SchemaMedia = SchemaShow | NonNullable<SearchResult["movie"]>;

function idsOf(ids: SchemaShow["ids"]): ShowIds {
  return {
    trakt: ids.trakt,
    slug: ids.slug,
    tmdb: ids.tmdb ?? undefined,
    imdb: ids.imdb ?? undefined,
  };
}

function buildHit(media: SchemaMedia, type: "show" | "movie"): SearchHit {
  return {
    key: `${type}:${media.ids.trakt}`,
    type,
    traktId: media.ids.trakt,
    title: media.title,
    year: media.year ?? null,
    posters: media.images?.poster ?? [],
    tmdbId: media.ids.tmdb ?? null,
    ids: idsOf(media.ids),
  };
}

/**
 * Map Trakt `/search/show,movie` rows to `SearchHit[]`. A row is
 * kept only when its declared `type` has the matching populated body, so a
 * malformed row (a declared type with no body) is dropped, not shown blank.
 */
export function assembleSearchHits(results: readonly SearchResult[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const result of results) {
    const media =
      result.type === "show" ? result.show : result.type === "movie" ? result.movie : undefined;
    if (media === undefined) continue;
    hits.push(buildHit(media, result.type === "show" ? "show" : "movie"));
  }
  return hits;
}

/** Map a bare show list (`/shows/trending`, `/shows/popular`) to the same poster-tile hits. */
export function assembleShowHits(shows: readonly ShowSummary[]): SearchHit[] {
  return shows.map((show) => buildHit(show, "show"));
}

/** Map a bare movie list (`/movies/trending`, `/movies/popular`, `/movies/:id/related`)
 * to movie-typed poster hits: the same `SearchHit` the browse tile routes to
 * `/movie/:id` and adds to the watchlist inline. */
export function assembleMovieHits(movies: readonly MovieSummary[]): SearchHit[] {
  return movies.map((movie) => buildHit(movie, "movie"));
}

/**
 * Relevance bucket for a hit against the query: exact title < prefix < substring
 * < no title match. Trakt's `/search` also matches aliases, overviews, and
 * people, so a raw score order buries the obvious title hit (e.g. "severance"
 * returning unrelated rows first); ranking by this bucket floats it up.
 */
function relevance(title: string, query: string): number {
  const t = title.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (q.length === 0 || t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return 3;
}

/**
 * Re-rank assembled hits so exact/near-exact title matches lead.
 * A stable sort on the relevance bucket keeps Trakt's own score order within a
 * bucket, so the fix elevates the obvious hit without shuffling the long tail.
 */
export function rankSearchHits(hits: readonly SearchHit[], query: string): SearchHit[] {
  return hits
    .map((hit, index) => ({ hit, index, rank: relevance(hit.title, query) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.hit);
}
