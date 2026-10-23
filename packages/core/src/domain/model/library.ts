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
  readonly aired: number;
  readonly completed: number;
  readonly left: number;
  readonly nextEpisode: EpisodeRef | null;
  readonly lastAired: EpisodeKey | null;
  readonly pendingAdvance: boolean;
}
