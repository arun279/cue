import { createPrefsStore } from "@cue/core/prefs/prefs-store";
import { preferenceStorage } from "./preference-storage";

/** The web app's instance of the shared preferences store. */
export const usePrefs = createPrefsStore(preferenceStorage);
