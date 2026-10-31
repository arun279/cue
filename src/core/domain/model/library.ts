import { isAired } from "../time";
import type { EpisodeIds } from "./ids";

export interface EpisodeRef {
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly firstAired: string | null;
  readonly still: string | null;
  readonly ids: EpisodeIds;
}

export interface EpisodeKey {
  readonly season: number;
  readonly number: number;
}

export function compareEpisodeKeys(a: EpisodeKey, b: EpisodeKey): number {
  return a.season - b.season || a.number - b.number;
}

export interface EpisodeState extends EpisodeKey {
  readonly watched: boolean;
}

/** The aired episodes still to watch from the next-up one on, leaving out specials and any skipped earlier. */
export function episodesLeftFrom(next: EpisodeKey | null, aired: readonly EpisodeState[]): number {
  if (next === null) return 0;
  return aired.filter(
    (episode) => episode.season !== 0 && !episode.watched && compareEpisodeKeys(episode, next) >= 0,
  ).length;
}

export function epCode(season: number, number: number): string {
  return `S${season} E${number}`;
}

export interface LibraryShow {
  readonly showId: number;
  readonly title: string;
  readonly year: number | null;
  readonly status: string;
  readonly hidden: boolean;
  readonly inWatchlist: boolean;
  readonly addedAt: string | null;
  readonly lastWatchedAt: string | null;
  /** Trakt's count of plays, unknown after this device's own write until the library next loads. */
  readonly plays: number | null;
  readonly aired: number;
  readonly completed: number;
  readonly left: number;
  readonly nextEpisode: EpisodeRef | null;
  readonly lastAired: EpisodeKey | null;
  readonly pendingAdvance: boolean;
}

export interface LibraryEntry extends LibraryShow {
  readonly tmdbId: number | null;
  readonly runtime: number | null;
  readonly posters: readonly string[];
}

export type ShowListing = Pick<
  LibraryEntry,
  | "showId"
  | "title"
  | "year"
  | "status"
  | "hidden"
  | "inWatchlist"
  | "addedAt"
  | "posters"
  | "tmdbId"
>;

/** A show saved to the watchlist or the collection that has no play yet. */
export function notStartedShow(listing: ShowListing): LibraryEntry {
  return {
    ...listing,
    lastWatchedAt: null,
    plays: 0,
    aired: 0,
    completed: 0,
    left: 0,
    nextEpisode: null,
    lastAired: null,
    runtime: null,
    pendingAdvance: false,
  };
}

export function advancePastNext(entry: LibraryEntry, watchedAt: string): LibraryEntry {
  const current = entry.nextEpisode;
  const nextEpisode: EpisodeRef | null =
    current === null ||
    entry.lastAired === null ||
    current.season !== entry.lastAired.season ||
    current.number >= entry.lastAired.number
      ? null
      : {
          season: current.season,
          number: current.number + 1,
          title: null,
          firstAired: null,
          still: null,
          ids: { trakt: 0 },
        };
  return {
    ...entry,
    completed: entry.completed + 1,
    left: Math.max(0, entry.left - 1),
    lastWatchedAt: watchedAt,
    plays: entry.plays === null ? null : entry.plays + 1,
    nextEpisode,
    pendingAdvance: true,
  };
}

export function quickMarkable(entry: LibraryEntry, now: number): boolean {
  return (
    !entry.pendingAdvance &&
    entry.nextEpisode !== null &&
    isAired(entry.nextEpisode.firstAired, now)
  );
}
