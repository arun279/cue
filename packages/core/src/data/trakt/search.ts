import type { MovieIds, ShowIds } from "../../domain/model/ids";
import type { MovieSummary, SearchResult, ShowSummary } from "./schemas";

export interface SearchHit {
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

export function assembleShowHits(shows: readonly ShowSummary[]): SearchHit[] {
  return shows.map((show) => buildHit(show, "show"));
}

export function assembleMovieHits(movies: readonly MovieSummary[]): SearchHit[] {
  return movies.map((movie) => buildHit(movie, "movie"));
}

// Trakt's /search also matches aliases, overviews and people.
function relevance(title: string, query: string): number {
  const t = title.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (q.length === 0 || t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return 3;
}

export function rankSearchHits(hits: readonly SearchHit[], query: string): SearchHit[] {
  return hits
    .map((hit, index) => ({ hit, index, rank: relevance(hit.title, query) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.hit);
}
