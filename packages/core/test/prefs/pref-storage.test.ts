import { describe, expect, it } from "vitest";
import { booleanPref, choicePref } from "../../src/prefs/pref-storage";
import { fakeStorage } from "./_storage";

const FLAG = "cue.flag";
const CHOICE = "cue.choice";
const OPTIONS = ["alpha", "beta"] as const;

describe("booleanPref", () => {
  it("reads an absent key as the fallback, either way round", () => {
    expect(booleanPref(fakeStorage(), FLAG, true).initial()).toBe(true);
    expect(booleanPref(fakeStorage(), FLAG, false).initial()).toBe(false);
  });

  it('stores "1" and "0" and reads them back', () => {
    const storage = fakeStorage();
    const pref = booleanPref(storage, FLAG, true);
    pref.persist(false);
    expect(storage.getItem(FLAG)).toBe("0");
    expect(pref.initial()).toBe(false);
    pref.persist(true);
    expect(storage.getItem(FLAG)).toBe("1");
    expect(pref.initial()).toBe(true);
  });

  it("reads anything that is not the stored true as false, whatever the fallback", () => {
    // A present key is an answer, so a malformed one is off rather than the
    // default: the value was written by some version of this app, and only "1"
    // has ever meant on.
    expect(booleanPref(fakeStorage({ [FLAG]: "true" }), FLAG, true).initial()).toBe(false);
    expect(booleanPref(fakeStorage({ [FLAG]: "" }), FLAG, true).initial()).toBe(false);
  });
});

describe("choicePref", () => {
  it("reads an absent key as the fallback", () => {
    expect(choicePref(fakeStorage(), CHOICE, OPTIONS, "alpha").initial()).toBe("alpha");
  });

  it("reads a stored member back", () => {
    const storage = fakeStorage();
    const pref = choicePref(storage, CHOICE, OPTIONS, "alpha");
    pref.persist("beta");
    expect(storage.getItem(CHOICE)).toBe("beta");
    expect(pref.initial()).toBe("beta");
  });

  it("stores a numeric option as its figure and reads it back as a number", () => {
    const storage = fakeStorage();
    const pref = choicePref(storage, CHOICE, [14, 21, 28] as const, 21);
    pref.persist(28);
    expect(storage.getItem(CHOICE)).toBe("28");
    expect(pref.initial()).toBe(28);
  });

  it("coerces a stale or corrupt value to the fallback rather than trusting it", () => {
    expect(choicePref(fakeStorage({ [CHOICE]: "gamma" }), CHOICE, OPTIONS, "alpha").initial()).toBe(
      "alpha",
    );
  });
});
