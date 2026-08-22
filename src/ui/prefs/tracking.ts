/** Which episode order the Up Next queue presents: the show whose oldest
 * unwatched episode has waited longest first (default), or the user's own
 * last-watched recency. Device-local, never Trakt-synced. */
export const NEXT_EPISODE_ORDER_OPTIONS = ["oldest-unwatched", "after-last-watched"] as const;
export type NextEpisodeOrder = (typeof NEXT_EPISODE_ORDER_OPTIONS)[number];

/** Which order the lapsed drawer presents: recently watched first (default), or longest idle. */
export const LAPSED_ORDER_OPTIONS = ["recently-watched", "longest-idle"] as const;
export type LapsedOrder = (typeof LAPSED_ORDER_OPTIONS)[number];

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

function choicePref<T extends string>(key: string, options: readonly T[], fallback: T) {
  return {
    initial(): T {
      try {
        const stored = localStorage.getItem(key);
        return options.find((option) => option === stored) ?? fallback;
      } catch {
        return fallback;
      }
    },
    persist(value: T): void {
      try {
        localStorage.setItem(key, value);
      } catch {
        // A restricted-storage failure just forgets the choice next visit: non-fatal.
      }
    },
  };
}

export const nextEpisodeOrderPref = choicePref(
  ORDER_KEY,
  NEXT_EPISODE_ORDER_OPTIONS,
  "oldest-unwatched",
);
export const lapsedOrderPref = choicePref(
  LAPSED_ORDER_KEY,
  LAPSED_ORDER_OPTIONS,
  "recently-watched",
);
