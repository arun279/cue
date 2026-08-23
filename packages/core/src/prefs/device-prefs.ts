import type { PreferenceStorage } from "../ports/preference-storage";
import { booleanPref, type Pref } from "./pref-storage";

/**
 * The two preferences that only mean anything inside the phone app, kept
 * device-local and never Trakt-synced.
 *
 * Haptics default ON: the one buzz on a mark, an undo or an armed pull is the
 * point-of-action confirmation, and a user who dislikes it turns it off.
 *
 * Episode reminders default OFF: they cost a notification permission, and both
 * platforms say to ask for one in context, from a deliberate opt-in, rather
 * than at launch. The Settings row is that opt-in.
 */
export const hapticsPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.haptics-enabled", true);

export const remindersPref = (storage: PreferenceStorage): Pref<boolean> =>
  booleanPref(storage, "cue.reminders-enabled", false);
