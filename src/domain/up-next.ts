import type { EpisodeRef, LibraryShow } from "./model/library";
import { toMs } from "./time";
import { computeWatchStatus } from "./watch-status";

type UpNextGroup = "fresh" | "continued" | "lapsed";

export interface UpNextItem {
  readonly showId: number;
  readonly title: string;
  readonly episode: EpisodeRef;
  readonly lastWatchedAt: string | null;
  readonly backlog: number;
  readonly group: UpNextGroup;
}

/**
 * The honest partition of the tonight list: `fresh` (this week's newly-aired next
 * episode), `continued` (mid-run, ordered by your own recency), and `lapsed`
 * (in-progress but idle past the threshold — the soft drawer at the bottom).
 */
export interface UpNextGroups {
  readonly fresh: UpNextItem[];
  readonly continued: UpNextItem[];
  readonly lapsed: UpNextItem[];
}

/**
 * Partition in-progress shows for Up Next on verifiable facts only — no taste,
 * popularity, or "for you" ranking. Shows in a state with no next to
 * queue (`abandoned`/`not-started`/`ended`) are always excluded; of the rest, a
 * `watching`/`lapsed` show (in-progress with an AIRED unwatched next) or a just-marked
 * show still carrying its provisional next projection is considered. Each lands in
 * exactly one group:
 *   • fresh     — the next unwatched episode aired within `newWindowMs` (this
 *                 week's drop). This overrides the idle flag, so a long-idle
 *                 returning show with a brand-new episode surfaces in "New" instead
 *                 of sinking into the drawer (the reconciled tension-#2 win).
 *   • lapsed    — idle past `thresholdMs` AND not fresh — the collapsed drawer.
 *   • continued — the rest, mid-binge, plus any show whose next is still a
 *                 provisional post-mark projection (`ids.trakt === 0`, air date
 *                 unknown): kept visible + locked, but never surfaced as this
 *                 week's fresh drop until the authoritative refetch lands.
 * Sorts: fresh by air date descending (newest first), continued by the user's own
 * last-watched recency (tiebreak air date), lapsed longest-idle-first.
 */
export function groupUpNext(
  shows: readonly LibraryShow[],
  now: number,
  thresholdMs: number,
  newWindowMs: number,
): UpNextGroups {
  const fresh: UpNextItem[] = [];
  const continued: UpNextItem[] = [];
  const lapsed: UpNextItem[] = [];

  for (const show of shows) {
    const ep = show.nextEpisode;
    if (ep === null) continue;
    const status = computeWatchStatus(show, now, thresholdMs);
    // Hard exclusions apply even to a just-marked show's optimistic projection: a
    // hidden (`abandoned`), never-started, or fully-watched `ended` show has no next
    // to queue, so a provisional projection must never resurrect it into Up Next.
    if (status === "abandoned" || status === "not-started" || status === "ended") continue;
    // A just-marked show still showing its optimistic next-episode projection
    // (`ids.trakt === 0`, air date not yet known): keep the card visible and locked
    // in Continue (pendingAdvance), but never as this week's fresh drop — that is how
    // a season-finale phantom would otherwise cling to the "New"/lead slot.
    const provisional = ep.ids.trakt === 0;
    let group: UpNextGroup;
    if (provisional) {
      group = "continued";
    } else {
      // Otherwise only in-progress shows with an aired next surface; `watching`/
      // `lapsed` already guarantee a non-null aired next, `caught-up` is excluded.
      if (status !== "watching" && status !== "lapsed") continue;
      const airedMs = toMs(ep.firstAired);
      const isFresh = airedMs !== null && now - airedMs <= newWindowMs;
      group = isFresh ? "fresh" : status === "lapsed" ? "lapsed" : "continued";
    }
    const item: UpNextItem = {
      showId: show.showId,
      title: show.title,
      episode: ep,
      lastWatchedAt: show.lastWatchedAt,
      backlog: Math.max(0, show.aired - show.completed),
      group,
    };
    if (group === "fresh") fresh.push(item);
    else if (group === "lapsed") lapsed.push(item);
    else continued.push(item);
  }

  fresh.sort(byAirDateDesc);
  continued.sort(byRecentlyWatched);
  lapsed.sort(byMostLapsed);
  return { fresh, continued, lapsed };
}

function airMs(item: UpNextItem): number {
  return toMs(item.episode.firstAired) ?? Number.NEGATIVE_INFINITY;
}

function watchedMs(item: UpNextItem): number {
  return toMs(item.lastWatchedAt) ?? Number.NEGATIVE_INFINITY;
}

/** Newest aired first. */
function byAirDateDesc(a: UpNextItem, b: UpNextItem): number {
  return airMs(b) - airMs(a);
}

/** Most-recently-watched first; ties fall through to air date (ascending). */
function byRecentlyWatched(a: UpNextItem, b: UpNextItem): number {
  const wa = watchedMs(a);
  const wb = watchedMs(b);
  if (wa !== wb) return wb - wa;
  return airMs(a) - airMs(b);
}

/** Longest-idle first — the oldest `lastWatchedAt` (unknown = oldest) leads. */
function byMostLapsed(a: UpNextItem, b: UpNextItem): number {
  return watchedMs(a) - watchedMs(b);
}
