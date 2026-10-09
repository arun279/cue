import {
  LAPSED_ORDER_OPTIONS,
  type LapsedOrder,
  NEXT_EPISODE_ORDER_OPTIONS,
  type NextEpisodeOrder,
} from "../domain/queue-order";
import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref, choicePref, type Pref } from "./pref-storage";

export type { LapsedOrder, NextEpisodeOrder };

export const hideStillsPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.hide-stills-until-watched", true);

export const nextEpisodeOrderPref = (storage: PreferenceStorage): Pref<NextEpisodeOrder> =>
  choicePref(storage, "cue.next-episode-order", NEXT_EPISODE_ORDER_OPTIONS, "oldest-unwatched");

export const lapsedOrderPref = (storage: PreferenceStorage): Pref<LapsedOrder> =>
  choicePref(storage, "cue.lapsed-order", LAPSED_ORDER_OPTIONS, "recently-watched");
