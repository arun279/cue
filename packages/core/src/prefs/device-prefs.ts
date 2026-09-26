import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref, type Pref } from "./pref-storage";

/**
 * The preferences that only mean anything inside the phone app, kept
 * device-local and never Trakt-synced.
 *
 * Haptics default ON: the one buzz on a mark, an undo or an armed pull is the
 * point-of-action confirmation, and a user who dislikes it turns it off.
 *
 * New-episode alerts default OFF: they cost a notification permission, and both
 * platforms say to ask for one in context, from a deliberate opt-in, rather
 * than at launch. The Settings row and the Calendar card are that opt-in, and
 * the card, once answered, stays answered. The daily summary that replaces them
 * is OFF too, and the muted shows start empty.
 */
export const hapticsPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.haptics-enabled", true);

export const remindersPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.reminders-enabled", false);

export const dailySummaryPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.daily-summary", false);

export const alertsCardAnsweredPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.alerts-card-answered", false);

const MUTED_SHOWS_KEY = "cue.muted-shows";

export const mutedShowsPref = (storage: PreferenceStorage): Pref<readonly number[]> => ({
  initial: () => storage.getItem(MUTED_SHOWS_KEY)?.split(",").filter(Boolean).map(Number) ?? [],
  persist: (ids) => storage.setItem(MUTED_SHOWS_KEY, ids.join(",")),
});
