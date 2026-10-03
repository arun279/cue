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

export function epCode(season: number, number: number): string {
  return `S${season} E${number}`;
}

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
  readonly lastAired: EpisodeKey | null;
  readonly pendingAdvance: boolean;
}
