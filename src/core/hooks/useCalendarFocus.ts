import { useQuery } from "@tanstack/react-query";
import { hiddenShowIdsOf } from "../domain/calendar";
import { neverWatched } from "../domain/watch-status";
import { usePrefs } from "../prefs/prefs-store";
import { queryStatus } from "../queries/freshness";
import { libraryQuery } from "../queries/library";
import { type UpNextData, useRuntime } from "../runtime/runtime";

export interface CalendarFocus {
  readonly loading: boolean;
  readonly playedShowIds: ReadonlySet<number> | undefined;
  readonly hiddenShowIds: ReadonlySet<number>;
}

interface LibraryFocus {
  readonly played: ReadonlySet<number>;
  readonly hidden: ReadonlySet<number>;
}

const NONE: ReadonlySet<number> = new Set();

const focusOf = ({ entries }: UpNextData): LibraryFocus => ({
  played: new Set(entries.filter((entry) => !neverWatched(entry)).map((entry) => entry.showId)),
  hidden: hiddenShowIdsOf(entries),
});

// Held until the library says which shows are played and hidden; a failed library read shows every row.
export function useCalendarFocus(enabled: boolean): CalendarFocus {
  const runtime = useRuntime();
  const everyWatchlistEpisode = usePrefs((state) => state.everyWatchlistEpisode);
  const library = useQuery({ ...libraryQuery(runtime), enabled, select: focusOf });
  return {
    loading: queryStatus(library, library.data !== undefined).isLoading,
    playedShowIds: everyWatchlistEpisode ? undefined : library.data?.played,
    hiddenShowIds: library.data?.hidden ?? NONE,
  };
}
