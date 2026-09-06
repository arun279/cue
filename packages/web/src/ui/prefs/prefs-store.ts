import { createPrefsStore } from "@cue/core/prefs/prefs-store";
import { preferenceStorage } from "./preference-storage";

/**
 * The web app's preferences store. Screens select from it with core's
 * `usePrefs`, which reads it through the provider the composition root renders;
 * this reference is for the callers that are not components, the router guards
 * and the haptics gate.
 */
export const prefsStore = createPrefsStore(preferenceStorage);
