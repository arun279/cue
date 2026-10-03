import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref, type Pref } from "./pref-storage";

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
