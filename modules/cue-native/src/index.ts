import { NativeModule, requireNativeModule } from "expo";
import type { Haptics } from "@/core/ports/haptics";

// Both native classes share one package: an Expo local module is one native compilation unit.

declare class CueLegacyPreferencesNativeModule extends NativeModule<Record<never, never>> {
  read(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  clearWebView(): Promise<void>;
}

/** Typed as the port itself, so the native classes answer exactly its verbs. */
export const CueHaptics = requireNativeModule<NativeModule<Record<never, never>> & Haptics>(
  "CueHaptics",
);

/** What Cue 1.0 left: its preferences, read through each platform's stored key shape, and its web view. */
export const CueLegacyPreferences =
  requireNativeModule<CueLegacyPreferencesNativeModule>("CueLegacyPreferences");
