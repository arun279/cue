import type { LegacyStore } from "@cue/core/ports/legacy-store";
import { CueLegacyPreferences } from "../../modules/cue-native/src";

export const legacyStore: LegacyStore = {
  read: (key) => CueLegacyPreferences.read(key),
  remove: (key) => CueLegacyPreferences.remove(key),
};
