import { create } from "zustand";
import { initialThresholdDays, persistThresholdDays } from "./threshold";

interface PrefsState {
  /** Days of inactivity before a show falls from Watching to Not-watched-in-a-while. */
  thresholdDays: number;
  setThresholdDays: (days: number) => void;
}

/**
 * Local display preferences — mirrors `theme-store`: the staleness
 * threshold that splits the Watching pile (and Up Next) from Not-watched-in-a-while,
 * persisted to `localStorage` and read live by `useUpNext` + the pile grouping.
 * Not Trakt-synced; it reverts to the principled 21-day default on a new device.
 */
export const usePrefs = create<PrefsState>((set) => ({
  thresholdDays: initialThresholdDays(),
  setThresholdDays: (thresholdDays) => {
    persistThresholdDays(thresholdDays);
    set({ thresholdDays });
  },
}));
