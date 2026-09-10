export function visibleSearchHits<T extends { readonly type: "show" | "movie" }>(
  hits: readonly T[],
  showsEnabled: boolean,
  moviesEnabled: boolean,
): readonly T[] {
  return hits.filter((hit) => (hit.type === "movie" ? moviesEnabled : showsEnabled));
}
