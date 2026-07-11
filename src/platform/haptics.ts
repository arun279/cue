import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { isNativePlatform } from "./platform";

/**
 * The tactile port: one light impact when a mark commits, one
 * distinct selection tick when it is taken back: nothing else. Structurally
 * matches the `@ui` Haptics port so the composition root can inject it; `@ui`
 * never imports this (dependency-cruiser: @capacitor/* lives only in platform).
 */
export interface NativeHaptics {
  markCommitted(): void;
  markUndone(): void;
}

const SILENT: NativeHaptics = { markCommitted() {}, markUndone() {} };

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Build the tactile seam. `isEnabled` is the Settings "Haptics" toggle, read at
 * fire time. On web / in tests (non-native) this is a pure silent no-op: the
 * browser build is deliberately silent (no `navigator.vibrate` fallback). On
 * native, each fire is additionally gated on the toggle AND `prefers-reduced-motion`,
 * and swallows a missing vibration engine / plugin rejection so it never breaks a mark.
 */
export function createNativeHaptics(isEnabled: () => boolean): NativeHaptics {
  if (!isNativePlatform()) return SILENT;
  const fire = (run: () => Promise<void>): void => {
    if (!isEnabled() || prefersReducedMotion()) return;
    void run().catch(() => {});
  };
  return {
    markCommitted: () => fire(() => Haptics.impact({ style: ImpactStyle.Light })),
    markUndone: () => fire(() => Haptics.selectionChanged()),
  };
}
