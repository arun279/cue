/**
 * The one read/write pair every device-local preference is built from. What it
 * owes each of them: an absent key reads as the principled default rather than
 * off/zero, a value that is no longer an option is ignored rather than restored,
 * and a store that refuses to answer never takes the app down with it.
 */
import { booleanPref, choicePref } from "@ui/prefs/pref-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("booleanPref", () => {
  const spoilers = booleanPref("cue.test-flag", true);

  it("reads an absent key as its fallback, not as off", () => {
    expect(spoilers.initial()).toBe(true);
    expect(booleanPref("cue.test-other", false).initial()).toBe(false);
  });

  it("round-trips a choice either way", () => {
    spoilers.persist(false);
    expect(spoilers.initial()).toBe(false);
    spoilers.persist(true);
    expect(spoilers.initial()).toBe(true);
  });
});

describe("choicePref", () => {
  const order = choicePref("cue.test-order", ["oldest", "recent"] as const, "oldest");
  const days = choicePref("cue.test-days", [14, 21, 28] as const, 21);

  it("round-trips a member of its option list", () => {
    order.persist("recent");
    expect(order.initial()).toBe("recent");
  });

  it("stores a numeric option as its figure and reads it back as a number", () => {
    days.persist(28);
    expect(localStorage.getItem("cue.test-days")).toBe("28");
    expect(days.initial()).toBe(28);
  });

  it("falls back rather than restoring a value the option list no longer holds", () => {
    // A build that dropped an option, or a hand-edited store.
    localStorage.setItem("cue.test-order", "by-title");
    localStorage.setItem("cue.test-days", "35");
    expect(order.initial()).toBe("oldest");
    expect(days.initial()).toBe(21);
  });
});

describe("a store that refuses to answer", () => {
  it("resolves to the default and swallows the failed write", () => {
    // Some privacy modes throw outright on both rather than storing nothing.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("restricted");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("restricted");
    });
    const haptics = booleanPref("cue.test-flag", true);

    expect(() => haptics.persist(false)).not.toThrow();
    expect(haptics.initial()).toBe(true);
  });
});
