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
  /** The episode's 16:9 screenshot URL (https), or null when Trakt has none. */
  readonly still: string | null;
  readonly ids: EpisodeIds;
}

/** A season/episode position, the order shows air in. */
export interface EpisodeKey {
  readonly season: number;
  readonly number: number;
}

export function compareEpisodeKeys(a: EpisodeKey, b: EpisodeKey): number {
  return a.season - b.season || a.number - b.number;
}

/** The quiet episode code: `S1 E5`, space-separated, no zero padding. Every
 * surface that names an episode reads from here, the morning digest included. */
export function epCode(season: number, number: number): string {
  return `S${season} E${number}`;
}

/**
 * The merged per-show snapshot the derived selectors read: `/sync/watched/shows`
 * (title, `lastWatchedAt`, `aired`, `completed`) + the hidden set + watchlist
 * membership, with `/shows/:id/progress/watched` supplying `nextEpisode` (and
 * overriding the counts) for the shows the read budget resolved. `aired` counts
 * episodes aired-to-date (Trakt progress semantics), `completed` counts watched, so
 * `completed < aired` is the backlog test every surface uses. A `nextEpisode` of
 * null with a backlog means the next episode is simply not known yet, never that
 * the show is caught up.
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
   * The last episode the snapshot knows aired (specials excluded): the end of the
   * progress breakdown when it was read, else the last watched episode in the bulk
   * breakdown, else null. Trakt's per-user progress refreshes only when the user
   * writes history for the show, so anything that aired after it is missing; this
   * frontier is what the calendar is reconciled against.
   */
  readonly lastAired: EpisodeKey | null;
}
