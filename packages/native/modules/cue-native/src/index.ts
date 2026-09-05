import type { Haptics } from "@cue/core/ports/haptics";
import { NativeModule, requireNativeModule } from "expo";

/**
 * The two native classes this module ships, and the whole of its JavaScript
 * surface. One module package rather than two, because an Expo local module is a
 * native compilation unit: splitting it would double the config, the podspec and
 * the Gradle file to separate two Swift classes.
 */

declare class CueLegacyPreferencesNativeModule extends NativeModule<Record<never, never>> {
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

/**
 * The port's verbs, one to one, rather than a second list of them: the Swift and
 * Kotlin classes exist to answer exactly this contract, and a verb added to the
 * port has to arrive here or the seam stops compiling. Every one is fired and
 * forgotten, dispatching to the platform's UI thread and returning nothing, so
 * no caller ever has a promise to discard.
 */
export const CueHaptics = requireNativeModule<NativeModule<Record<never, never>> & Haptics>(
  "CueHaptics",
);

/** Capacitor Preferences, read through the key shape each platform actually
 * used. Migration only. */
export const CueLegacyPreferences =
  requireNativeModule<CueLegacyPreferencesNativeModule>("CueLegacyPreferences");
