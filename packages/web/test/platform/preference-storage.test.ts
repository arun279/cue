/**
 * The web `PreferenceStorage`. What it uniquely owns: the restricted-storage
 * degradation. `localStorage` throws outright in some privacy modes, the port
 * promises never to throw, and Playwright cannot make a real browser's
 * `localStorage` throw, so this is the only layer that can assert a preference
 * which cannot be remembered still resolves to its principled default.
 */

import { clearLocalPreferences, preferenceStorage } from "@ui/prefs/preference-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every `localStorage` access rejected, the way a locked-down browser does it. */
function denyStorage(): void {
  for (const method of ["getItem", "setItem", "removeItem", "key"] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
  }
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preferenceStorage", () => {
  it("reads back what it was asked to remember", () => {
    preferenceStorage.setItem("cue.theme", "dark");
    expect(preferenceStorage.getItem("cue.theme")).toBe("dark");
  });

  it("reports an unset preference as absent, so the caller takes its default", () => {
    expect(preferenceStorage.getItem("cue.never-set")).toBeNull();
  });

  it("drops only the namespace it is given", () => {
    preferenceStorage.setItem("cue.theme", "dark");
    preferenceStorage.setItem("cue.persist-requested", "1");
    preferenceStorage.setItem("other.key", "kept");
    preferenceStorage.clearNamespace("cue.");
    expect(preferenceStorage.getItem("cue.theme")).toBeNull();
    expect(preferenceStorage.getItem("cue.persist-requested")).toBeNull();
    expect(preferenceStorage.getItem("other.key")).toBe("kept");
  });

  it("clears every key under the namespace, not every other one", () => {
    for (let index = 0; index < 10; index += 1) preferenceStorage.setItem(`cue.p${index}`, "on");
    clearLocalPreferences();
    expect(localStorage.length).toBe(0);
  });

  describe("when the browser refuses storage outright", () => {
    it("resolves a read to absent instead of throwing", () => {
      denyStorage();
      expect(preferenceStorage.getItem("cue.theme")).toBeNull();
    });

    it("forgets a write instead of throwing", () => {
      denyStorage();
      expect(() => {
        preferenceStorage.setItem("cue.theme", "dark");
      }).not.toThrow();
    });

    it("lets sign-out finish instead of throwing", () => {
      preferenceStorage.setItem("cue.theme", "dark");
      denyStorage();
      expect(() => {
        clearLocalPreferences();
      }).not.toThrow();
    });
  });
});
