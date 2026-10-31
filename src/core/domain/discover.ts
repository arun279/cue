import type { MovieIds, ShowIds } from "./model/ids";

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

export function visibleSearchHits<T extends { readonly type: "show" | "movie" }>(
  hits: readonly T[],
  showsEnabled: boolean,
  moviesEnabled: boolean,
): readonly T[] {
  return hits.filter((hit) => (hit.type === "movie" ? moviesEnabled : showsEnabled));
}
