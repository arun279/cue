import type { LegacyStore } from "@/core/ports/legacy-store";
import { CueLegacyPreferences } from "../../modules/cue-native/src";

export const legacyStore: LegacyStore = {
  read: (key) => CueLegacyPreferences.read(key),
  remove: (key) => CueLegacyPreferences.remove(key),
};
