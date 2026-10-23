import { recentCalendarStart } from "@cue/core/domain/calendar";
import { dayKeyOf } from "@cue/core/domain/day";
import { localTimeZone } from "@cue/core/domain/time";
import { calendarQuery, recentlyAiredQuery } from "@cue/core/queries/calendar";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import type { UpNextCard } from "../../src/screens/up-next/model";
import { entry as upNextEntry } from "./up-next";

const SHOW_ID = 8801;

export const episode = {
  season: 3,
  number: 6,
  title: "Salt Air",
  firstAired: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  still: null,
  ids: { trakt: 1 },
};

export const entry = upNextEntry({
  showId: SHOW_ID,
  lastWatchedAt: new Date().toISOString(),
  aired: 22,
  completed: 20,
  nextEpisode: episode,
  lastAired: null,
});

export const cardOf = (pendingAdvance: boolean): UpNextCard => ({
  item: { showId: SHOW_ID, title: entry.title, episode, lastWatchedAt: null },
  entry: { ...entry, pendingAdvance },
});

/** The two calendar reads every home surface issues, seeded empty so a
 * measurement is of the screen rather than of a network that is not there. */
export function seedCalendars(client: QueryClient, cue: CueRuntime): void {
  const today = dayKeyOf(localTimeZone(), Date.now());
  const empty = { entries: [], hiddenShowIds: [] };
  client.setQueryData(calendarQuery(cue, today).queryKey, empty);
  client.setQueryData(recentlyAiredQuery(cue, recentCalendarStart(today)).queryKey, empty);
}
