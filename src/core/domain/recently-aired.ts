import type { CalendarEntry } from "./calendar";
import { compareEpisodeKeys, type LibraryShow } from "./model/library";
import { isAired } from "./time";

// Trakt refreshes per-user progress only when the user writes history for that show.
export function reconcileRecentlyAired<T extends LibraryShow>(
  shows: readonly T[],
  calendar: readonly CalendarEntry[],
  now: number,
): T[] {
  const airedByShow = new Map<number, CalendarEntry[]>();
  for (const entry of calendar) {
    if (entry.season === 0 || !isAired(entry.firstAired, now)) continue;
    const list = airedByShow.get(entry.showId) ?? [];
    list.push(entry);
    airedByShow.set(entry.showId, list);
  }

  return shows.map((show) => {
    const recent = airedByShow.get(show.showId);
    if (show.completed <= 0 || show.lastAired === null || recent === undefined) return show;
    const frontier = show.lastAired;
    const unknown = recent
      .filter((entry) => compareEpisodeKeys(entry, frontier) > 0)
      .sort(compareEpisodeKeys);
    const last = unknown[unknown.length - 1];
    if (last === undefined) return show;
    return {
      ...show,
      aired: show.aired + unknown.length,
      lastAired: { season: last.season, number: last.number },
    };
  });
}

export function needsNextEpisode(show: LibraryShow, now: number): boolean {
  const next = show.nextEpisode;
  return (
    show.completed > 0 &&
    show.aired > show.completed &&
    !(next !== null && (next.ids.trakt === 0 || isAired(next.firstAired, now)))
  );
}
