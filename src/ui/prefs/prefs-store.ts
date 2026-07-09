import { create } from "zustand";
import { initialHapticsEnabled, persistHapticsEnabled } from "./haptics-pref";
import {
  initialMediaVisibility,
  type MediaVisibility,
  persistMediaVisibility,
} from "./media-visibility";
import { initialThresholdDays, persistThresholdDays } from "./threshold";

interface PrefsState {
  /** Days of inactivity before a show falls from Watching to Not-watched-in-a-while. */
  thresholdDays: number;
  setThresholdDays: (days: number) => void;
  /** Media-visibility: a device-local pref so a single-medium user is
   * never shown the other. Both ON by default; disabling the last one is refused. */
  showsEnabled: boolean;
  moviesEnabled: boolean;
  setShowsEnabled: (enabled: boolean) => void;
  setMoviesEnabled: (enabled: boolean) => void;
  /** The one buzz on a mark/undo: ON by default, device-local,
   * read by the injected haptics seam at fire time. Silent no-op on web regardless. */
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
}

/**
 * Local display preferences — mirrors
 * `theme-store`: the staleness threshold that splits the Watching pile (and Up
 * Next) from Not-watched-in-a-while, and the TV/Movies visibility toggles.
 * Persisted to `localStorage`, never Trakt-synced; both revert to their principled
 * defaults (21 days, both media on) on a new device.
 */
export const usePrefs = create<PrefsState>((set, get) => {
  const media = initialMediaVisibility();
  // One commit path enforces the single invariant — the app is never emptied of
  // both media — so a setter that would turn off the last-enabled medium no-ops.
  const commit = (next: MediaVisibility): void => {
    if (!next.showsEnabled && !next.moviesEnabled) return;
    persistMediaVisibility(next);
    set(next);
  };
  return {
    thresholdDays: initialThresholdDays(),
    setThresholdDays: (thresholdDays) => {
      persistThresholdDays(thresholdDays);
      set({ thresholdDays });
    },
    showsEnabled: media.showsEnabled,
    moviesEnabled: media.moviesEnabled,
    setShowsEnabled: (showsEnabled) => commit({ showsEnabled, moviesEnabled: get().moviesEnabled }),
    setMoviesEnabled: (moviesEnabled) =>
      commit({ showsEnabled: get().showsEnabled, moviesEnabled }),
    hapticsEnabled: initialHapticsEnabled(),
    setHapticsEnabled: (hapticsEnabled) => {
      persistHapticsEnabled(hapticsEnabled);
      set({ hapticsEnabled });
    },
  };
});
