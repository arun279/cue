import type { Haptics } from "@cue/core/ports/haptics";
import { CueHaptics } from "../../modules/cue-native/src";

// Not expo-haptics: it exposes no prepare(), so its first fire is cold.
export function createNativeHaptics(isEnabled: () => boolean): Haptics {
  const fire =
    (verb: () => void): (() => void) =>
    () => {
      if (isEnabled()) verb();
    };

  return {
    success: fire(() => CueHaptics.success()),
    failure: fire(() => CueHaptics.failure()),
    warning: fire(() => CueHaptics.warning()),
    thresholdActivate: fire(() => CueHaptics.thresholdActivate()),
    thresholdDeactivate: fire(() => CueHaptics.thresholdDeactivate()),
    selection: fire(() => CueHaptics.selection()),
    contextClick: fire(() => CueHaptics.contextClick()),
    prepare: fire(() => CueHaptics.prepare()),
  };
}
