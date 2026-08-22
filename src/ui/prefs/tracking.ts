/** Which episode order the Up Next queue presents: the show whose oldest
 * unwatched episode has waited longest first (default), or the user's own
 * last-watched recency. Device-local, never Trakt-synced. */
export type NextEpisodeOrder = "oldest-unwatched" | "after-last-watched";

/** Which order the lapsed drawer presents: recently watched first (default), or longest idle. */
export type LapsedOrder = "recently-watched" | "longest-idle";

const STILLS_KEY = "cue.hide-stills-until-watched";
const ORDER_KEY = "cue.next-episode-order";
const LAPSED_ORDER_KEY = "cue.lapsed-order";

/**
 * The spoiler guard for episode stills: ON by default (an unwatched episode's
 * still is a spoiler until revealed). Absent reads as ON; only an explicit "0"
 * disables. Consumed by the episode sheet; persisted here with the other
 * device-local tracking prefs.
 */
export function initialHideStillsUntilWatched(): boolean {
  try {
    return localStorage.getItem(STILLS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function persistHideStillsUntilWatched(enabled: boolean): void {
  try {
    localStorage.setItem(STILLS_KEY, enabled ? "1" : "0");
  } catch {
    // A restricted-storage failure just forgets the choice next visit: non-fatal.
  }
}

export function initialNextEpisodeOrder(): NextEpisodeOrder {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return raw === "after-last-watched" ? raw : "oldest-unwatched";
  } catch {
    return "oldest-unwatched";
  }
}

export function persistNextEpisodeOrder(order: NextEpisodeOrder): void {
  try {
    localStorage.setItem(ORDER_KEY, order);
  } catch {
    // A restricted-storage failure just forgets the choice next visit: non-fatal.
  }
}

export function initialLapsedOrder(): LapsedOrder {
  try {
    const raw = localStorage.getItem(LAPSED_ORDER_KEY);
    return raw === "longest-idle" ? raw : "recently-watched";
  } catch {
    return "recently-watched";
  }
}

export function persistLapsedOrder(order: LapsedOrder): void {
  try {
    localStorage.setItem(LAPSED_ORDER_KEY, order);
  } catch {
    // A restricted-storage failure just forgets the choice next visit: non-fatal.
  }
}
