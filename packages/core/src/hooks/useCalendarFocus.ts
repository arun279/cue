import { useQuery } from "@tanstack/react-query";
import { neverWatched } from "../domain/watch-status";
import { usePrefs } from "../prefs/prefs-store";
import { libraryQuery } from "../queries/library";
import { type UpNextData, useRuntime } from "../runtime/runtime";

export interface CalendarFocus {
  readonly loading: boolean;
  readonly playedShowIds: ReadonlySet<number> | undefined;
}

const playedShowIds = ({ entries }: UpNextData): ReadonlySet<number> =>
  new Set(entries.filter((entry) => !neverWatched(entry)).map((entry) => entry.showId));

export function useCalendarFocus(enabled: boolean): CalendarFocus {
  const runtime = useRuntime();
  const everyWatchlistEpisode = usePrefs((state) => state.everyWatchlistEpisode);
  const played = useQuery({
    ...libraryQuery(runtime),
    enabled: enabled && !everyWatchlistEpisode,
    select: playedShowIds,
  });
  return everyWatchlistEpisode
    ? { loading: false, playedShowIds: undefined }
    : { loading: played.isLoading, playedShowIds: played.data };
}
