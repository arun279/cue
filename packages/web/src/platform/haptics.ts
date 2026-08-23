import { registerPlugin } from "@capacitor/core";
import { type Haptics, SILENT } from "@cue/core/domain/ports/haptics";
import { isNativePlatform } from "./platform";

/**
 * The app's own haptics plugin, implemented in `ios/App/App/CueHaptics.swift`
 * and `android/app/src/main/java/app/cuetracker/CueHapticsPlugin.kt`. Each
 * method names an interaction, not an effect, so each platform can answer with
 * its own system feedback: prepared UIFeedbackGenerators on iOS,
 * `View.performHapticFeedback` with `HapticFeedbackConstants` on Android.
 */
interface CueHapticsPlugin {
  success(): Promise<void>;
  thresholdActivate(): Promise<void>;
  thresholdDeactivate(): Promise<void>;
  selection(): Promise<void>;
  contextClick(): Promise<void>;
  prepare(): Promise<void>;
}

const CueHaptics = registerPlugin<CueHapticsPlugin>("CueHaptics");

/**
 * Build the tactile seam. `isEnabled` is the Settings "Haptics" toggle, read at
 * fire time. On web / in tests (non-native) this is a pure silent no-op: the
 * browser build is deliberately silent (no `navigator.vibrate` fallback, which
 * has never shipped in Safari anyway). On native the toggle is the only app-side
 * gate: both platforms already honour their own system haptics settings, and
 * Apple's instruction is to fire the event and let the system decide. Plugin
 * rejections are swallowed so a missing engine never breaks a mark.
 */
export function createNativeHaptics(isEnabled: () => boolean): Haptics {
  if (!isNativePlatform()) return SILENT;
  const fire = (run: () => Promise<void>): void => {
    if (!isEnabled()) return;
    void run().catch(() => {});
  };
  return {
    success: () => fire(() => CueHaptics.success()),
    thresholdActivate: () => fire(() => CueHaptics.thresholdActivate()),
    thresholdDeactivate: () => fire(() => CueHaptics.thresholdDeactivate()),
    selection: () => fire(() => CueHaptics.selection()),
    contextClick: () => fire(() => CueHaptics.contextClick()),
    prepare: () => fire(() => CueHaptics.prepare()),
  };
}
