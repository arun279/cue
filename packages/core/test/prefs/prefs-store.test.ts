import { describe, expect, it } from "vitest";
import { createPrefsStore } from "../../src/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "../../src/prefs/threshold";
import { fakeStorage } from "./_storage";

describe("createPrefsStore defaults", () => {
  it("starts every preference at its principled default on a fresh device", () => {
    const state = createPrefsStore(fakeStorage()).getState();
    expect(state.thresholdDays).toBe(21);
    expect(state.showsEnabled).toBe(true);
    expect(state.moviesEnabled).toBe(true);
    expect(state.hapticsEnabled).toBe(true);
    expect(state.remindersEnabled).toBe(false);
    expect(state.hideStillsUntilWatched).toBe(true);
    expect(state.nextEpisodeOrder).toBe("oldest-unwatched");
    expect(state.lapsedOrder).toBe("recently-watched");
  });

  it("reads a stored choice back and coerces a malformed one", () => {
    const stored = createPrefsStore(
      fakeStorage({
        "cue.staleness-threshold-days": "42",
        "cue.haptics-enabled": "0",
        "cue.next-episode-order": "after-last-watched",
      }),
    ).getState();
    expect(stored.thresholdDays).toBe(42);
    expect(stored.hapticsEnabled).toBe(false);
    expect(stored.nextEpisodeOrder).toBe("after-last-watched");

    const corrupt = createPrefsStore(
      fakeStorage({
        "cue.staleness-threshold-days": "17",
        "cue.next-episode-order": "by-vibes",
        "cue.lapsed-order": "",
      }),
    ).getState();
    expect(corrupt.thresholdDays).toBe(21);
    expect(corrupt.nextEpisodeOrder).toBe("oldest-unwatched");
    expect(corrupt.lapsedOrder).toBe("recently-watched");
  });

  it("only accepts a threshold from the offered option set", () => {
    for (const days of THRESHOLD_OPTIONS) {
      const storage = fakeStorage();
      createPrefsStore(storage).getState().setThresholdDays(days);
      expect(createPrefsStore(storage).getState().thresholdDays).toBe(days);
    }
    const storage = fakeStorage({ "cue.staleness-threshold-days": "35" });
    expect(createPrefsStore(storage).getState().thresholdDays).toBe(21);
  });
});

describe("the last-medium-on invariant", () => {
  it("refuses to turn off the last enabled medium, and does not persist the refusal", () => {
    const storage = fakeStorage();
    const store = createPrefsStore(storage);
    store.getState().setMoviesEnabled(false);
    expect(store.getState()).toMatchObject({ showsEnabled: true, moviesEnabled: false });

    store.getState().setShowsEnabled(false);
    expect(store.getState()).toMatchObject({ showsEnabled: true, moviesEnabled: false });
    expect(storage.getItem("cue.shows-enabled")).toBe("1");
  });

  it("lets either medium come back on", () => {
    const store = createPrefsStore(fakeStorage());
    store.getState().setShowsEnabled(false);
    expect(store.getState()).toMatchObject({ showsEnabled: false, moviesEnabled: true });
    store.getState().setShowsEnabled(true);
    expect(store.getState()).toMatchObject({ showsEnabled: true, moviesEnabled: true });
  });
});

describe("persistence", () => {
  it("writes every setter through, so a new store on the same storage restores it", () => {
    const storage = fakeStorage();
    const first = createPrefsStore(storage).getState();
    first.setHapticsEnabled(false);
    first.setRemindersEnabled(true);
    first.setHideStillsUntilWatched(false);
    first.setNextEpisodeOrder("after-last-watched");
    first.setLapsedOrder("longest-idle");
    first.setThresholdDays(14);

    expect(createPrefsStore(storage).getState()).toMatchObject({
      hapticsEnabled: false,
      remindersEnabled: true,
      hideStillsUntilWatched: false,
      nextEpisodeOrder: "after-last-watched",
      lapsedOrder: "longest-idle",
      thresholdDays: 14,
    });
  });
});
