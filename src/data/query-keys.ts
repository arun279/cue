/**
 * The single query-key factory, shared by data + ui hooks.
 * Established here and append-only thereafter. Keys are readonly tuples so
 * TanStack Query hashing is stable and invalidation targets line up 1:1 with the
 * `InvalidationTarget` strings.
 */
export const queryKeys = {
  watchedShows: () => ["watched", "shows"] as const,
  watchedMovies: () => ["watched", "movies"] as const,
  progress: (showId: number | string) => ["progress", "watched", showId] as const,
  watchlist: (type: "shows" | "movies") => ["watchlist", type] as const,
  ratings: (type: "shows" | "movies" | "episodes") => ["ratings", type] as const,
  hidden: () => ["hidden", "progress_watched"] as const,
  calendar: (startDate: string, days: number) => ["calendar", "my-shows", startDate, days] as const,
  search: (query: string, types: string) => ["search", types, query] as const,
  lastActivities: () => ["sync", "last_activities"] as const,
  tmdbConfiguration: () => ["tmdb", "configuration"] as const,
  tmdbTv: (tmdbId: number) => ["tmdb", "tv", tmdbId] as const,
} as const;
