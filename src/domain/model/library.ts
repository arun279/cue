import type { EpisodeIds } from "./ids";

/**
 * The next episode Trakt's `progress/watched` points a show at. `firstAired`
 * is what the aired-only Up Next filter tests against; `null` means the
 * air date is unknown/announced-only.
 */
export interface EpisodeRef {
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly firstAired: string | null;
  readonly ids: EpisodeIds;
}

/**
 * The merged per-show snapshot the derived selectors read: `/sync/watched/shows`
 * (title, `lastWatchedAt`) + `/shows/:id/progress/watched` (`aired`, `completed`,
 * `nextEpisode`) + the hidden set + watchlist membership. `aired` counts episodes
 * aired-to-date (Trakt progress semantics), `completed` counts watched.
 */
export interface LibraryShow {
  readonly showId: number;
  readonly title: string;
  readonly status: string;
  readonly hidden: boolean;
  readonly inWatchlist: boolean;
  readonly lastWatchedAt: string | null;
  readonly aired: number;
  readonly completed: number;
  readonly nextEpisode: EpisodeRef | null;
  /**
   * True when this show's per-show progress was fetched, so `aired`/`completed`/
   * `nextEpisode` are authoritative. False for a show beyond the cold-sync progress
   * budget: `completed` is its bulk watched count but `aired` is
   * unknown: its watch status is `sync-pending`, never fabricated as caught-up.
   */
  readonly progressKnown: boolean;
}
