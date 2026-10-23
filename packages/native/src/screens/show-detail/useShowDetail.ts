import type { LibraryEntry } from "@cue/core/data/trakt/library";
import {
  firstUnwatchedAired,
  type SeasonView,
  type ShowInfo,
  type ShowProgress,
  toEpisodeRef,
} from "@cue/core/data/trakt/show-detail";
import { episodesLeftFrom } from "@cue/core/domain/model/library";
import { combineStatus } from "@cue/core/queries/freshness";
import { libraryQuery } from "@cue/core/queries/library";
import { showInfoQuery, showProgressQuery, showSeasonsQuery } from "@cue/core/queries/shows";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQueries, useQuery } from "@tanstack/react-query";

export type ShowHeader = ShowInfo & ShowProgress;

export function useShowDetail(showId: number) {
  const runtime = useRuntime();
  const header = useQueries({
    queries: [showInfoQuery(runtime, showId), showProgressQuery(runtime, showId)],
    combine: ([info, progress]) => {
      const data =
        info.data === undefined || progress.data === undefined
          ? undefined
          : { ...info.data, ...progress.data };
      return {
        data,
        ...combineStatus([info, progress], data !== undefined),
        refetch: () => {
          void info.refetch();
          void progress.refetch();
        },
      };
    },
  });
  const library = useQuery({
    ...libraryQuery(runtime),
    enabled: false,
    select: (data) => data.entries.find((entry) => entry.showId === showId),
  });
  const seasons = useQuery(showSeasonsQuery(runtime, showId));
  const entry =
    header.data === undefined ? undefined : entryFor(header.data, library.data, seasons.data ?? []);
  return { header, seasons, entry };
}

const UNCACHED = {
  hidden: false,
  inWatchlist: false,
  addedAt: null,
  lastWatchedAt: null,
  runtime: null,
};

function entryFor(
  header: ShowHeader,
  cached: LibraryEntry | undefined,
  seasons: readonly SeasonView[],
): LibraryEntry {
  if (cached?.pendingAdvance) return cached;
  const { hidden, inWatchlist, addedAt, lastWatchedAt, runtime } = cached ?? UNCACHED;
  const skipsUnaired = header.completed < header.aired && !header.nextEpisode?.aired;
  const next = skipsUnaired ? firstUnwatchedAired(seasons) : header.nextEpisode;
  return {
    showId: header.ids.trakt,
    title: header.title,
    year: header.year,
    status: header.status,
    aired: header.aired,
    completed: header.completed,
    left: skipsUnaired
      ? episodesLeftFrom(
          next,
          seasons.flatMap((season) => season.episodes.filter((episode) => episode.aired)),
        )
      : header.left,
    lastAired: header.lastAired,
    nextEpisode: next === null ? null : toEpisodeRef(next),
    hidden,
    inWatchlist,
    addedAt,
    lastWatchedAt,
    tmdbId: header.ids.tmdb ?? null,
    runtime,
    posters: header.posters,
    pendingAdvance: false,
  };
}
