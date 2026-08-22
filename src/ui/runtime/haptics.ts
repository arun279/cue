import { createContext, useContext } from "react";

/**
 * The tactile port the UI fires through, injected from the composition root so
 * `@ui` stays free of `@app`/`@platform`. The vocabulary is the platforms' own:
 * every method names an interaction both iOS and Android document a feedback
 * pattern for, so the native side can pick the system effect rather than invent
 * a vibration. The default is a silent no-op, so the browser build, the
 * pre-token shell, and tests need no provider and stay silent.
 */
export interface Haptics {
  /** A task completed: a watch mark landed, or was taken back. */
  success(): void;
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

const SILENT: Haptics = {
  success() {},
  thresholdActivate() {},
  thresholdDeactivate() {},
  selection() {},
  contextClick() {},
  prepare() {},
};

const HapticsContext = createContext<Haptics>(SILENT);

export const HapticsProvider = HapticsContext.Provider;

export function useHaptics(): Haptics {
  return useContext(HapticsContext);
}
