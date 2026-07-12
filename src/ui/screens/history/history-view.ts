import type { HistoryDay, HistoryEntry } from "@domain/history";
import type { EpisodeRowLink } from "@ui/components/EpisodeRow";
import { epCode } from "@ui/format";

/** Where a play's row links: the movie page, or the episode sheet it logged. */
export function entryLink(entry: HistoryEntry): EpisodeRowLink {
  if (entry.type === "movie") {
    return { to: "/movie/$movieId", params: { movieId: String(entry.mediaId) } };
  }
  return {
    to: "/show/$showId/episode/$season/$episode",
    params: {
      showId: String(entry.mediaId),
      season: String(entry.season ?? 0),
      episode: String(entry.number ?? 0),
    },
  };
}

/**
 * One rendered History row: the newest play of an item within one local day,
 * carrying how many plays of that item the day holds. Same-item plays collapse
 * into a single row (a same-day rewatch is one fact with a ×N count, not N
 * near-identical rows); removal peels plays newest-first, so the row's face is
 * always the play a tap on the check would remove.
 */
export interface HistoryRowVM {
  readonly entry: HistoryEntry;
  readonly plays: number;
}

interface HistoryDayVM {
  readonly dayKey: string;
  readonly label: string;
  /** The quiet per-day play rollup, e.g. "3 episodes · 1 movie". */
  readonly rollup: string;
  readonly rows: readonly HistoryRowVM[];
}

/** The linear render stream: day groups with a year separator at each boundary. */
type HistoryBlock =
  | { readonly kind: "year"; readonly year: number }
  | { readonly kind: "day"; readonly day: HistoryDayVM };

/** The one identity a play collapses/counts under: the exact episode or movie. */
function itemKey(entry: HistoryEntry): string {
  return entry.type === "movie"
    ? `movie:${entry.mediaId}`
    : `episode:${entry.mediaId}:${entry.season ?? 0}:${entry.number ?? 0}`;
}

/** The row's secondary text: `S1 E4 Old Cases` for an episode, release year for a movie. */
export function entryDetail(entry: HistoryEntry): string {
  if (entry.type === "movie") return entry.year === null ? "Movie" : String(entry.year);
  const code = epCode(entry.season ?? 0, entry.number ?? 0);
  return entry.episodeTitle === null ? code : `${code} ${entry.episodeTitle}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function dayRollup(rows: readonly HistoryRowVM[]): string {
  let episodes = 0;
  let movies = 0;
  for (const row of rows) {
    if (row.entry.type === "movie") movies += row.plays;
    else episodes += row.plays;
  }
  const parts: string[] = [];
  if (episodes > 0) parts.push(plural(episodes, "episode"));
  if (movies > 0) parts.push(plural(movies, "movie"));
  return parts.join(" · ");
}

/**
 * Build the render stream from the loaded days: filter by title (a live,
 * client-side narrowing of what is already loaded — never a server search),
 * collapse same-item plays per day, and insert a year separator wherever two
 * adjacent days straddle a year boundary. Days emptied by the filter vanish.
 */
export function buildBlocks(days: readonly HistoryDay[], titleQuery: string): HistoryBlock[] {
  const needle = titleQuery.trim().toLowerCase();
  const blocks: HistoryBlock[] = [];
  let prevYear: number | null = null;
  for (const day of days) {
    const entries = day.groups
      .flatMap((group) => group.entries)
      .filter((entry) => needle === "" || entry.title.toLowerCase().includes(needle));
    if (entries.length === 0) continue;
    const rows: HistoryRowVM[] = [];
    const index = new Map<string, number>();
    for (const entry of entries) {
      const key = itemKey(entry);
      const at = index.get(key);
      if (at === undefined) {
        index.set(key, rows.length);
        rows.push({ entry, plays: 1 });
      } else {
        const row = rows[at] as HistoryRowVM;
        rows[at] = { ...row, plays: row.plays + 1 };
      }
    }
    const year = Number(day.dayKey.slice(0, 4));
    if (prevYear !== null && year !== prevYear) blocks.push({ kind: "year", year });
    prevYear = year;
    blocks.push({
      kind: "day",
      day: { dayKey: day.dayKey, label: day.label, rollup: dayRollup(rows), rows },
    });
  }
  return blocks;
}

/**
 * How many plays of `entry`'s item the loaded window holds: the honest bound for
 * the removal snackbar's "N remain" (history is unbounded, so plays beyond the
 * loaded pages are never claimed).
 */
export function countItemPlays(days: readonly HistoryDay[], entry: HistoryEntry): number {
  const key = itemKey(entry);
  let count = 0;
  for (const day of days) {
    for (const group of day.groups) {
      for (const each of group.entries) if (itemKey(each) === key) count += 1;
    }
  }
  return count;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * The month-jump chip's face: the scoped month/year when one is set, otherwise
 * the current month (the top of the unbounded recent feed IS the present).
 */
export function jumpLabel(
  year: number | undefined,
  month: number | undefined,
  now: number,
): string {
  if (year === undefined) {
    const date = new Date(now);
    return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (month === undefined) return String(year);
  return `${MONTHS_SHORT[month - 1]} ${year}`;
}
