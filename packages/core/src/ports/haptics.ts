import { createContext, useContext } from "react";

/**
 * The tactile port, declared where both sides of the seam can read it: `@ui`
 * fires through it, `@platform` implements it, and the composition root hands
 * one to the other. The vocabulary is the platforms' own: every method names an
 * interaction both iOS and Android document a feedback pattern for, so the
 * native side can pick the system effect rather than invent a vibration.
 */
export interface Haptics {
  /** A task completed: a watch mark landed, or was taken back. */
  success(): void;
  /** A task did not complete: a mark or a take-back the user was told failed. */
  failure(): void;
  /** A drag just crossed the threshold that arms its action on release. */
  thresholdActivate(): void;
  /** The drag retreated back under that threshold, disarming it. */
  thresholdDeactivate(): void;
  /** Movement between discrete values: a tab change, a sheet detent snap. */
  selection(): void;
  /** A long press opened a context menu. */
  contextClick(): void;
  /** Warm the feedback engine at the start of a gesture that will tick, so the
   * threshold tick is not late enough to read as unrelated to the gesture. */
  prepare(): void;
}

/** Fires nothing: the browser build, the pre-token shell, and tests. */
export const SILENT: Haptics = {
  success() {},
  failure() {},
  thresholdActivate() {},
  thresholdDeactivate() {},
  selection() {},
  contextClick() {},
  prepare() {},
};

/** The port as `@ui` reaches it, injected from the composition root so `@ui`
 * stays free of `@app`/`@platform`. The default is `SILENT`, so the browser
 * build, the pre-token shell and tests need no provider. */
const HapticsContext = createContext<Haptics>(SILENT);

export const HapticsProvider = HapticsContext.Provider;

export function useHaptics(): Haptics {
  return useContext(HapticsContext);
}
