import { describe, expect, it } from "vitest";
import { createPrefsStore } from "../../src/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "../../src/prefs/threshold";
import { memoryPreferenceStorage } from "../support/stores";

describe("createPrefsStore defaults", () => {
  it("starts every preference at its principled default on a fresh device", () => {
    const state = createPrefsStore(memoryPreferenceStorage()).getState();
    expect(state.thresholdDays).toBe(21);
    expect(state.showsEnabled).toBe(true);
    expect(state.moviesEnabled).toBe(true);
    expect(state.hapticsEnabled).toBe(true);
    expect(state.remindersEnabled).toBe(false);
    expect(state.dailySummary).toBe(false);
    expect(state.mutedShowIds).toEqual([]);
    expect(state.hideStillsUntilWatched).toBe(true);
    expect(state.everyWatchlistEpisode).toBe(false);
    expect(state.nextEpisodeOrder).toBe("after-last-watched");
    expect(state.lapsedOrder).toBe("recently-watched");
    expect(state.theme).toBe("system");
  });

  it("reads a stored choice back and coerces a malformed one", () => {
    const stored = createPrefsStore(
      memoryPreferenceStorage({
        "cue.staleness-threshold-days": "42",
        "cue.haptics-enabled": "0",
        "cue.next-episode-order": "oldest-unwatched",
      }),
    ).getState();
    expect(stored.thresholdDays).toBe(42);
    expect(stored.hapticsEnabled).toBe(false);
    expect(stored.nextEpisodeOrder).toBe("oldest-unwatched");

    const corrupt = createPrefsStore(
      memoryPreferenceStorage({
        "cue.staleness-threshold-days": "17",
        "cue.next-episode-order": "by-vibes",
        "cue.lapsed-order": "",
      }),
    ).getState();
    expect(corrupt.thresholdDays).toBe(21);
    expect(corrupt.nextEpisodeOrder).toBe("after-last-watched");
    expect(corrupt.lapsedOrder).toBe("recently-watched");
  });

  it("only accepts a threshold from the offered option set", () => {
    for (const days of THRESHOLD_OPTIONS) {
      const storage = memoryPreferenceStorage();
      createPrefsStore(storage).getState().setThresholdDays(days);
      expect(createPrefsStore(storage).getState().thresholdDays).toBe(days);
    }
    const storage = memoryPreferenceStorage({ "cue.staleness-threshold-days": "35" });
    expect(createPrefsStore(storage).getState().thresholdDays).toBe(21);
  });
});

describe("the last-medium-on invariant", () => {
  it("refuses to turn off the last enabled medium, and does not persist the refusal", () => {
    const storage = memoryPreferenceStorage();
    const store = createPrefsStore(storage);
    store.getState().setMoviesEnabled(false);
    expect(store.getState()).toMatchObject({ showsEnabled: true, moviesEnabled: false });

    store.getState().setShowsEnabled(false);
    expect(store.getState()).toMatchObject({ showsEnabled: true, moviesEnabled: false });
    expect(storage.getItem("cue.shows-enabled")).toBe("1");
  });

  it("lets either medium come back on", () => {
    const store = createPrefsStore(memoryPreferenceStorage());
    store.getState().setShowsEnabled(false);
    expect(store.getState()).toMatchObject({ showsEnabled: false, moviesEnabled: true });
    store.getState().setShowsEnabled(true);
    expect(store.getState()).toMatchObject({ showsEnabled: true, moviesEnabled: true });
  });
});

describe("persistence", () => {
  it("writes every setter through, so a new store on the same storage restores it", () => {
    const storage = memoryPreferenceStorage();
    const first = createPrefsStore(storage).getState();
    first.setHapticsEnabled(false);
    first.setRemindersEnabled(true);
    first.setDailySummary(true);
    first.setShowMuted(8801, true);
    first.setShowMuted(8802, true);
    first.setShowMuted(8801, false);
    first.setHideStillsUntilWatched(false);
    first.setEveryWatchlistEpisode(true);
    first.setNextEpisodeOrder("oldest-unwatched");
    first.setLapsedOrder("longest-idle");
    first.setThresholdDays(14);

    expect(createPrefsStore(storage).getState()).toMatchObject({
      hapticsEnabled: false,
      remindersEnabled: true,
      dailySummary: true,
      mutedShowIds: [8802],
      hideStillsUntilWatched: false,
      everyWatchlistEpisode: true,
      nextEpisodeOrder: "oldest-unwatched",
      lapsedOrder: "longest-idle",
      thresholdDays: 14,
    });
  });
});

describe("theme", () => {
  it.each(["system", "dark", "light"] as const)("persists and publishes the %s theme", (theme) => {
    const storage = memoryPreferenceStorage();
    const store = createPrefsStore(storage);
    store.getState().setTheme(theme);
    expect(store.getState().theme).toBe(theme);
    expect(storage.getItem("cue.theme")).toBe(theme);
    expect(createPrefsStore(storage).getState().theme).toBe(theme);
  });

  it("uses the system appearance for a missing or invalid stored theme", () => {
    expect(createPrefsStore(memoryPreferenceStorage()).getState().theme).toBe("system");
    expect(
      createPrefsStore(memoryPreferenceStorage({ "cue.theme": "invalid" })).getState().theme,
    ).toBe("system");
  });
});
