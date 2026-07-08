/**
 * The single query-key factory, shared by data + ui hooks.
 * Established here and append-only thereafter. Keys are readonly tuples so
 * TanStack Query hashing is stable. The `InvalidationTarget` strings map onto
 * these composite keys through `invalidationKeys` (query-invalidation.ts), which
 * the last-activities reconciler drives.
 */
export const queryKeys = {
  watchlist: (type: "shows" | "movies") => ["watchlist", type] as const,
  ratings: (type: "shows" | "movies" | "episodes") => ["ratings", type] as const,
  calendar: (startDate: string, days: number) => ["calendar", "my-shows", startDate, days] as const,
  /** Prefix over every windowed `calendar(...)` query, for invalidating them as one. */
  calendarPrefix: () => ["calendar", "my-shows"] as const,
  search: (query: string, types: string) => ["search", types, query] as const,
  discover: () => ["discover", "shows-movies"] as const,
  lastActivities: () => ["sync", "last_activities"] as const,
  userStats: () => ["users", "me", "stats"] as const,
  /** The reverse-chronological watch history, per type filter AND decade scope
   * ("recent" | "2019" | "2019-03") — an infinite query paged one Trakt page at a
   * time. Each scope caches separately; the prefix still invalidates all as one. */
  history: (type: "all" | "tv" | "movies", scope = "recent") => ["history", type, scope] as const,
  /** Prefix over every `history(...)` query, so any watch change invalidates them as one. */
  historyPrefix: () => ["history"] as const,
  /** The assembled Up Next library — one persisted entry that paints instantly on boot. */
  library: () => ["library"] as const,
  /** The assembled movie library (watched + watchlist), grouped into My Shows shelves. */
  movieLibrary: () => ["movie-library"] as const,
  movieHeader: (movieId: number) => ["movie", "header", movieId] as const,
  /** "More like this" related movies for one movie's detail rail. */
  movieRelated: (movieId: number) => ["movie", "related", movieId] as const,
  showHeader: (showId: number) => ["show", "header", showId] as const,
  showSeasons: (showId: number) => ["show", "seasons", showId] as const,
  episode: (showId: number, season: number, number: number) =>
    ["show", "episode", showId, season, number] as const,
  /** Prefix over every `episode(showId, …)` of one show, for invalidating them as
   * one when a bulk/range mark touched an unknown set of that show's episodes. */
  episodePrefix: (showId: number) => ["show", "episode", showId] as const,
} as const;
