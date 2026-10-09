import { createContext, useContext } from "react";

export interface Haptics {
  success(): void;
  failure(): void;
  warning(): void;
  thresholdActivate(): void;
  thresholdDeactivate(): void;
  selection(): void;
  contextClick(): void;
  prepare(): void;
}

const SILENT: Haptics = {
  success() {},
  failure() {},
  warning() {},
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
