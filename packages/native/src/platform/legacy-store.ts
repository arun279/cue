import type { LegacyStore } from "@cue/core/ports/legacy-store";
import { CueLegacyPreferences } from "../../modules/cue-native/src";

/** Capacitor Preferences, through the local module that knows each platform's
 * key shape. Migration only, and it never writes. */
export const legacyCapacitorStore: LegacyStore = {
  read: (key) => CueLegacyPreferences.read(key),
  remove: (key) => CueLegacyPreferences.remove(key),
};
