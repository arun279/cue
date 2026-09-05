import type { Haptics } from "@cue/core/ports/haptics";
import { CueHaptics } from "../../modules/cue-native/src";

/**
 * The eight verbs, over the local module.
 *
 * `expo-haptics` is not a dependency of this app and cannot be: it exposes no
 * `prepare()`, so every generator is cold on first fire and a swipe threshold
 * tick lands late enough to read as unrelated to the gesture; and its Android
 * side funnels everything into a raw `Vibrator` waveform, which is what
 * Android's own haptics guidance tells you not to use for touch feedback.
 *
 * The Settings toggle is read at fire time rather than captured, exactly as the
 * web build reads it, so turning haptics off takes effect on the next tap
 * instead of the next launch. Both platforms honour their own system haptics
 * setting underneath, and nothing here second-guesses that.
 */
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
