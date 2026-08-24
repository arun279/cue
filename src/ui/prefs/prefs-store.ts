import { create } from "zustand";
import { hapticsPref, remindersPref } from "./device-prefs";
import {
  initialMediaVisibility,
  type MediaVisibility,
  persistMediaVisibility,
} from "./media-visibility";
import { thresholdPref } from "./threshold";
import {
  hideStillsPref,
  type LapsedOrder,
  lapsedOrderPref,
  type NextEpisodeOrder,
  nextEpisodeOrderPref,
} from "./tracking";

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
  /** The one buzz on a mark/undo/armed pull: ON by default, device-local,
   * read by the injected haptics seam at fire time. Silent no-op on web regardless. */
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
  /** The daily "airing today" digest: OFF by default, flipped on only after the
   * OS notification permission is granted in context. */
  remindersEnabled: boolean;
  setRemindersEnabled: (enabled: boolean) => void;
  /** Spoiler guard: blur unwatched episode stills until revealed. Default ON. */
  hideStillsUntilWatched: boolean;
  setHideStillsUntilWatched: (enabled: boolean) => void;
  /** How the Up Next queue orders shows: oldest waiting episode first (default)
   * or the user's own last-watched recency. */
  nextEpisodeOrder: NextEpisodeOrder;
  setNextEpisodeOrder: (order: NextEpisodeOrder) => void;
  /** How the Haven't watched lately drawer orders shows: most recently watched first
   * (default) or longest idle first. */
  lapsedOrder: LapsedOrder;
  setLapsedOrder: (order: LapsedOrder) => void;
}

/**
 * Local display preferences: mirrors
 * `theme-store`: the staleness threshold that splits the Watching pile (and Up
 * Next) from Not-watched-in-a-while, and the TV/Movies visibility toggles.
 * Persisted to `localStorage`, never Trakt-synced; both revert to their principled
 * defaults (21 days, both media on) on a new device.
 */
export const usePrefs = create<PrefsState>((set, get) => {
  const media = initialMediaVisibility();
  // One commit path enforces the single invariant: the app is never emptied of
  // both media: so a setter that would turn off the last-enabled medium no-ops.
  const commit = (next: MediaVisibility): void => {
    if (!next.showsEnabled && !next.moviesEnabled) return;
    persistMediaVisibility(next);
    set(next);
  };
  return {
    thresholdDays: thresholdPref.initial(),
    setThresholdDays: (thresholdDays) => {
      thresholdPref.persist(thresholdDays);
      set({ thresholdDays });
    },
    showsEnabled: media.showsEnabled,
    moviesEnabled: media.moviesEnabled,
    setShowsEnabled: (showsEnabled) => commit({ showsEnabled, moviesEnabled: get().moviesEnabled }),
    setMoviesEnabled: (moviesEnabled) =>
      commit({ showsEnabled: get().showsEnabled, moviesEnabled }),
    hapticsEnabled: hapticsPref.initial(),
    setHapticsEnabled: (hapticsEnabled) => {
      hapticsPref.persist(hapticsEnabled);
      set({ hapticsEnabled });
    },
    remindersEnabled: remindersPref.initial(),
    setRemindersEnabled: (remindersEnabled) => {
      remindersPref.persist(remindersEnabled);
      set({ remindersEnabled });
    },
    hideStillsUntilWatched: hideStillsPref.initial(),
    setHideStillsUntilWatched: (hideStillsUntilWatched) => {
      hideStillsPref.persist(hideStillsUntilWatched);
      set({ hideStillsUntilWatched });
    },
    nextEpisodeOrder: nextEpisodeOrderPref.initial(),
    setNextEpisodeOrder: (nextEpisodeOrder) => {
      nextEpisodeOrderPref.persist(nextEpisodeOrder);
      set({ nextEpisodeOrder });
    },
    lapsedOrder: lapsedOrderPref.initial(),
    setLapsedOrder: (lapsedOrder) => {
      lapsedOrderPref.persist(lapsedOrder);
      set({ lapsedOrder });
    },
  };
});
