import { create } from "zustand";
import type { PreferenceStorage } from "../ports/preference-storage";
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
 * Local display preferences: the staleness threshold that splits the Watching
 * pile (and Up Next) from Not-watched-in-a-while, the TV/Movies visibility
 * toggles, and the device-local switches. Never Trakt-synced; every one reverts
 * to its principled default (21 days, both media on) on a new device.
 *
 * A factory rather than a module-level store, because the storage differs per
 * app and the reads happen at import time, before anything React could inject.
 */
export function createPrefsStore(storage: PreferenceStorage) {
  const haptics = hapticsPref(storage);
  const reminders = remindersPref(storage);
  const hideStills = hideStillsPref(storage);
  const nextEpisodeOrder = nextEpisodeOrderPref(storage);
  const lapsedOrder = lapsedOrderPref(storage);
  const threshold = thresholdPref(storage);

  return create<PrefsState>((set, get) => {
    const media = initialMediaVisibility(storage);
    // One commit path enforces the single invariant: the app is never emptied of
    // both media: so a setter that would turn off the last-enabled medium no-ops.
    const commit = (next: MediaVisibility): void => {
      if (!next.showsEnabled && !next.moviesEnabled) return;
      persistMediaVisibility(storage, next);
      set(next);
    };
    return {
      thresholdDays: threshold.initial(),
      setThresholdDays: (thresholdDays) => {
        threshold.persist(thresholdDays);
        set({ thresholdDays });
      },
      showsEnabled: media.showsEnabled,
      moviesEnabled: media.moviesEnabled,
      setShowsEnabled: (showsEnabled) =>
        commit({ showsEnabled, moviesEnabled: get().moviesEnabled }),
      setMoviesEnabled: (moviesEnabled) =>
        commit({ showsEnabled: get().showsEnabled, moviesEnabled }),
      hapticsEnabled: haptics.initial(),
      setHapticsEnabled: (hapticsEnabled) => {
        haptics.persist(hapticsEnabled);
        set({ hapticsEnabled });
      },
      remindersEnabled: reminders.initial(),
      setRemindersEnabled: (remindersEnabled) => {
        reminders.persist(remindersEnabled);
        set({ remindersEnabled });
      },
      hideStillsUntilWatched: hideStills.initial(),
      setHideStillsUntilWatched: (hideStillsUntilWatched) => {
        hideStills.persist(hideStillsUntilWatched);
        set({ hideStillsUntilWatched });
      },
      nextEpisodeOrder: nextEpisodeOrder.initial(),
      setNextEpisodeOrder: (order) => {
        nextEpisodeOrder.persist(order);
        set({ nextEpisodeOrder: order });
      },
      lapsedOrder: lapsedOrder.initial(),
      setLapsedOrder: (order) => {
        lapsedOrder.persist(order);
        set({ lapsedOrder: order });
      },
    };
  });
}
