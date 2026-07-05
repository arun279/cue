import type { MovieIds, ShowIds } from "@domain/model/ids";
import type { SearchResult } from "./schemas";

/** A show/movie search hit, flattened for the result row + inline watchlist add. */
export interface SearchHit {
  /** `${type}:${trakt}` — stable React key + dedupe handle. */
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

function idsOf(ids: SchemaShow["ids"]): ShowIds {
  return {
    trakt: ids.trakt,
    slug: ids.slug,
    tmdb: ids.tmdb ?? undefined,
    imdb: ids.imdb ?? undefined,
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
    const type = result.type === "show" ? "show" : "movie";
    hits.push({
      key: `${type}:${media.ids.trakt}`,
      type,
      traktId: media.ids.trakt,
      title: media.title,
      year: media.year ?? null,
      posters: media.images?.poster ?? [],
      tmdbId: media.ids.tmdb ?? null,
      ids: idsOf(media.ids),
    });
  }
  return hits;
}
