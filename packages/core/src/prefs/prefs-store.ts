import { createContext, useContext } from "react";
import { type StoreApi, useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PreferenceStorage } from "../ports/preference-storage";
import {
  alertsCardAnsweredPref,
  dailySummaryPref,
  hapticsPref,
  mutedShowsPref,
  remindersPref,
} from "./device-prefs";
import {
  initialMediaVisibility,
  type MediaVisibility,
  persistMediaVisibility,
} from "./media-visibility";
import { choicePref } from "./pref-storage";
import { thresholdPref } from "./threshold";
import {
  hideStillsPref,
  type LapsedOrder,
  lapsedOrderPref,
  type NextEpisodeOrder,
  nextEpisodeOrderPref,
} from "./tracking";

export type Theme = "system" | "dark" | "light";

interface PrefsState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  thresholdDays: number;
  setThresholdDays: (days: number) => void;
  showsEnabled: boolean;
  moviesEnabled: boolean;
  setShowsEnabled: (enabled: boolean) => void;
  setMoviesEnabled: (enabled: boolean) => void;
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
  remindersEnabled: boolean;
  setRemindersEnabled: (enabled: boolean) => void;
  alertsCardAnswered: boolean;
  answerAlertsCard: () => void;
  dailySummary: boolean;
  setDailySummary: (enabled: boolean) => void;
  mutedShowIds: readonly number[];
  setShowMuted: (showId: number, muted: boolean) => void;
  hideStillsUntilWatched: boolean;
  setHideStillsUntilWatched: (enabled: boolean) => void;
  nextEpisodeOrder: NextEpisodeOrder;
  setNextEpisodeOrder: (order: NextEpisodeOrder) => void;
  lapsedOrder: LapsedOrder;
  setLapsedOrder: (order: LapsedOrder) => void;
}

export type PrefsStore = StoreApi<PrefsState>;

export function createPrefsStore(storage: PreferenceStorage): PrefsStore {
  const theme = choicePref<Theme>(storage, "cue.theme", ["system", "dark", "light"], "system");
  const haptics = hapticsPref(storage);
  const reminders = remindersPref(storage);
  const alertsCard = alertsCardAnsweredPref(storage);
  const dailySummary = dailySummaryPref(storage);
  const mutedShows = mutedShowsPref(storage);
  const hideStills = hideStillsPref(storage);
  const nextEpisodeOrder = nextEpisodeOrderPref(storage);
  const lapsedOrder = lapsedOrderPref(storage);
  const threshold = thresholdPref(storage);

  return createStore<PrefsState>((set, get) => {
    const media = initialMediaVisibility(storage);
    const commit = (next: MediaVisibility): void => {
      if (!next.showsEnabled && !next.moviesEnabled) return;
      persistMediaVisibility(storage, next);
      set(next);
    };
    return {
      theme: theme.initial(),
      setTheme: (value) => {
        theme.persist(value);
        set({ theme: value });
      },
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
      alertsCardAnswered: alertsCard.initial(),
      answerAlertsCard: () => {
        alertsCard.persist(true);
        set({ alertsCardAnswered: true });
      },
      dailySummary: dailySummary.initial(),
      setDailySummary: (enabled) => {
        dailySummary.persist(enabled);
        set({ dailySummary: enabled });
      },
      mutedShowIds: mutedShows.initial(),
      setShowMuted: (showId, muted) => {
        const others = get().mutedShowIds.filter((id) => id !== showId);
        const mutedShowIds = muted ? [...others, showId] : others;
        mutedShows.persist(mutedShowIds);
        set({ mutedShowIds });
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

const inert = (): PrefsStore => {
  const values = new Map<string, string>();
  return createPrefsStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    clearNamespace: (prefix) => {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key);
    },
  });
};

const PrefsContext = createContext<PrefsStore>(inert());

export const PrefsProvider = PrefsContext.Provider;

export function usePrefs<T>(selector: (state: PrefsState) => T): T {
  return useStore(useContext(PrefsContext), selector);
}
