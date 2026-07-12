import { createContext, useContext } from "react";

/**
 * The tactile port the mark surface fires through, injected from
 * the composition root so `@ui` stays free of `@app`/`@platform`. `markCommitted`
 * fires once when a watch mark lands optimistically; `markUndone` once when it is
 * taken back; `swipeThreshold` once when a swipe gesture crosses its commit
 * threshold. The default is a silent no-op, so the browser build, the pre-token
 * shell, and tests need no provider and stay silent.
 */
export interface Haptics {
  markCommitted(): void;
  markUndone(): void;
  swipeThreshold(): void;
}

const SILENT: Haptics = { markCommitted() {}, markUndone() {}, swipeThreshold() {} };

const HapticsContext = createContext<Haptics>(SILENT);

export const HapticsProvider = HapticsContext.Provider;

export function useHaptics(): Haptics {
  return useContext(HapticsContext);
}
