import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref, choicePref, type Pref } from "./pref-storage";

/** Which episode order the Up Next queue presents: the show whose oldest
 * unwatched episode has waited longest first (default), or the user's own
 * last-watched recency. Device-local, never Trakt-synced. */
export const NEXT_EPISODE_ORDER_OPTIONS = ["oldest-unwatched", "after-last-watched"] as const;
export type NextEpisodeOrder = (typeof NEXT_EPISODE_ORDER_OPTIONS)[number];

/** Which order the lapsed drawer presents: recently watched first (default), or longest idle. */
export const LAPSED_ORDER_OPTIONS = ["recently-watched", "longest-idle"] as const;
export type LapsedOrder = (typeof LAPSED_ORDER_OPTIONS)[number];

/**
 * The spoiler guard for episode stills: ON by default, because an unwatched
 * episode's still is a spoiler until it is revealed.
 */
export const hideStillsPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.hide-stills-until-watched", true);

export const nextEpisodeOrderPref = (storage: PreferenceStorage): Pref<NextEpisodeOrder> =>
  choicePref(storage, "cue.next-episode-order", NEXT_EPISODE_ORDER_OPTIONS, "oldest-unwatched");

export const lapsedOrderPref = (storage: PreferenceStorage): Pref<LapsedOrder> =>
  choicePref(storage, "cue.lapsed-order", LAPSED_ORDER_OPTIONS, "recently-watched");
