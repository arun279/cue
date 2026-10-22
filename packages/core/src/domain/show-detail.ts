import { localDaysBetween } from "./day";
import type { EpisodeKey, EpisodeRef } from "./model/library";
import { localTimeZone, toMs } from "./time";
import { isTerminalStatus } from "./watch-status";
import type { PlayPolicy } from "./write-queue/receipt";

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

export type ContinuePosition =
  | { readonly kind: "next" | "finished" | "caught-up" }
  | { readonly kind: "returning"; readonly season: number; readonly days: number };

export function continuePosition(
  entry: {
    readonly pendingAdvance: boolean;
    readonly nextEpisode: EpisodeRef | null;
    readonly completed: number;
    readonly aired: number;
    readonly status: string;
  },
  now: number,
  timeZone: string = localTimeZone(),
): ContinuePosition {
  if (entry.pendingAdvance || entry.completed < entry.aired) return { kind: "next" };
  if (isTerminalStatus(entry.status)) return { kind: "finished" };
  const next = entry.nextEpisode;
  const firstAired = toMs(next?.firstAired ?? null);
  return next !== null && firstAired !== null && firstAired > now
    ? {
        kind: "returning",
        season: next.season,
        days: Math.max(1, localDaysBetween(timeZone, now, firstAired)),
      }
    : { kind: "caught-up" };
}

export const returnsLine = ({ season, days }: { readonly season: number; readonly days: number }) =>
  `S${season} returns in ${days} ${days === 1 ? "day" : "days"}`;

export interface SeasonConfirmation {
  readonly kind: "mark" | "remaining" | "unmark";
  readonly title: string;
  readonly message: string;
  readonly primary: string;
  readonly secondary?: string;
  readonly secondaryDestructive?: boolean;
}

export const episodeCount = (count: number): string =>
  `${count} ${count === 1 ? "episode" : "episodes"}`;

function rewatchCopy(
  aired: number,
  watched: number,
  policy: PlayPolicy,
): Pick<SeasonConfirmation, "secondary" | "secondaryDestructive"> & { readonly note: string } {
  const dates = watched === 1 ? "the watch date of the 1" : `the watch dates of the ${watched}`;
  if (policy === "one-play") {
    return {
      note: ` Your Trakt account keeps one play per episode, so this replaces ${dates} you've watched. You can change this in your Trakt settings.`,
      secondary: `Mark all ${aired} again`,
      secondaryDestructive: true,
    };
  }
  return {
    note:
      policy === "unknown"
        ? ` If your Trakt account keeps one play per episode, this replaces ${dates} you've watched.`
        : "",
    secondary: `Mark all ${aired} again (rewatch)`,
  };
}

export function seasonConfirmation(
  season: {
    readonly number: number;
    readonly airedCount: number;
    readonly completedCount: number;
  },
  policy: PlayPolicy = "unknown",
): SeasonConfirmation {
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
  const { note, ...rewatch } = rewatchCopy(season.airedCount, season.completedCount, policy);
  return {
    kind: "remaining",
    title: `Mark ${name} watched?`,
    message: `${remaining} of ${season.airedCount} episodes are unwatched.${note}`,
    primary: `Mark ${remaining} remaining`,
    ...rewatch,
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
