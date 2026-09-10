import type { EpisodeKey, EpisodeRef } from "./model/library";
import { DAY_MS, toMs } from "./time";
import { isTerminalStatus } from "./watch-status";

interface EpisodePosition extends EpisodeKey {
  readonly aired: boolean;
  readonly watched: boolean;
}

interface SeasonPosition {
  readonly number: number;
  readonly isSpecial: boolean;
  readonly isHidden: boolean;
  readonly episodes: readonly EpisodePosition[];
}

export function orderSeasons<T extends SeasonPosition>(seasons: readonly T[]): T[] {
  return [...seasons].sort(
    (a, b) => Number(a.isSpecial) - Number(b.isSpecial) || b.number - a.number,
  );
}

export function defaultSeason(
  seasons: readonly SeasonPosition[],
  next: EpisodeKey | null,
): number | null {
  const regular = orderSeasons(seasons).filter((season) => !season.isSpecial && !season.isHidden);
  return (
    regular.find((season) => season.number === next?.season)?.number ?? regular[0]?.number ?? null
  );
}

export function earlierUnwatchedCount(
  seasons: readonly SeasonPosition[],
  bound: EpisodeKey,
): number {
  return seasons
    .filter((season) => !season.isSpecial && !season.isHidden)
    .reduce(
      (count, season) =>
        count +
        season.episodes.filter(
          (episode) =>
            episode.aired &&
            !episode.watched &&
            (episode.season < bound.season ||
              (episode.season === bound.season && episode.number < bound.number)),
        ).length,
      0,
    );
}

export type ContinueKind = "next" | "returning" | "finished" | "caught-up";

export function continueKind(
  entry: {
    readonly pendingAdvance: boolean;
    readonly nextEpisode: EpisodeRef | null;
    readonly completed: number;
    readonly aired: number;
    readonly status: string;
  },
  now: number,
): ContinueKind {
  if (entry.pendingAdvance || entry.completed < entry.aired) return "next";
  if (isTerminalStatus(entry.status)) return "finished";
  const firstAired = toMs(entry.nextEpisode?.firstAired ?? null);
  return firstAired !== null && firstAired > now ? "returning" : "caught-up";
}

export function returnsLine(episode: EpisodeRef, now: number): string {
  const days = Math.max(0, Math.ceil(((toMs(episode.firstAired) ?? now) - now) / DAY_MS));
  return `S${episode.season} returns ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}`;
}

export interface SeasonConfirmation {
  readonly kind: "mark" | "remaining" | "unmark";
  readonly title: string;
  readonly message: string;
  readonly primary: string;
  readonly secondary?: string;
}

export const episodeCount = (count: number): string =>
  `${count} ${count === 1 ? "episode" : "episodes"}`;

export function seasonConfirmation(season: {
  readonly number: number;
  readonly airedCount: number;
  readonly completedCount: number;
}): SeasonConfirmation {
  const name = season.number === 0 ? "Specials" : `Season ${season.number}`;
  const remaining = Math.max(0, season.airedCount - season.completedCount);
  if (remaining === 0)
    return {
      kind: "unmark",
      title: `Unmark ${name}?`,
      message: `Removes ${episodeCount(season.completedCount)} from your history.`,
      primary: `Remove ${episodeCount(season.completedCount)}`,
    };
  if (season.completedCount === 0)
    return {
      kind: "mark",
      title: `Mark ${name} watched?`,
      message: `${episodeCount(remaining)} will be added to your history.`,
      primary: `Mark ${episodeCount(remaining)}`,
    };
  return {
    kind: "remaining",
    title: `Mark ${name} watched?`,
    message: `${remaining} of ${season.airedCount} episodes are unwatched.`,
    primary: `Mark ${remaining} remaining`,
    secondary: `Mark all ${season.airedCount} again (rewatch)`,
  };
}

export function episodeNavigation<T extends EpisodeKey>(
  seasons: readonly { readonly episodes: readonly T[] }[],
  target: EpisodeKey,
): { readonly prev: T | null; readonly next: T | null } {
  const episodes = seasons
    .flatMap((season) => season.episodes)
    .sort(
      (a, b) =>
        Number(a.season === 0) - Number(b.season === 0) ||
        a.season - b.season ||
        a.number - b.number,
    );
  const index = episodes.findIndex(
    (episode) => episode.season === target.season && episode.number === target.number,
  );
  return {
    prev: episodes[index - 1] ?? null,
    next: index < 0 ? null : (episodes[index + 1] ?? null),
  };
}
