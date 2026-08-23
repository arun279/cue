import { NativeModule, requireNativeModule } from "expo";

/**
 * The two native classes this module ships, and the whole of its JavaScript
 * surface. One module package rather than two, because an Expo local module is a
 * native compilation unit: splitting it would double the config, the podspec and
 * the Gradle file to separate two Swift classes.
 */

declare class CueHapticsNativeModule extends NativeModule<Record<never, never>> {
  success(): void;
  failure(): void;
  thresholdActivate(): void;
  thresholdDeactivate(): void;
  selection(): void;
  contextClick(): void;
  prepare(): void;
}

declare class CueLegacyPreferencesNativeModule extends NativeModule<Record<never, never>> {
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

/** The seven verbs, fired and forgotten: every one dispatches to the platform's
 * UI thread and returns nothing, so no caller ever has a promise to discard. */
export const CueHaptics = requireNativeModule<CueHapticsNativeModule>("CueHaptics");

/** Capacitor Preferences, read through the key shape each platform actually
 * used. Migration only. */
export const CueLegacyPreferences =
  requireNativeModule<CueLegacyPreferencesNativeModule>("CueLegacyPreferences");
