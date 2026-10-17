import { expect, it } from "vitest";
import { createPrefsStore } from "../../src/prefs/prefs-store";
import { fakeStorage } from "./_storage";

it.each(["system", "dark", "light"] as const)("persists and publishes the %s theme", (theme) => {
  const storage = fakeStorage();
  const store = createPrefsStore(storage);
  store.getState().setTheme(theme);
  expect(store.getState().theme).toBe(theme);
  expect(storage.getItem("cue.theme")).toBe(theme);
  expect(createPrefsStore(storage).getState().theme).toBe(theme);
});

it("uses the system appearance for a missing or invalid stored theme", () => {
  expect(createPrefsStore(fakeStorage()).getState().theme).toBe("system");
  expect(createPrefsStore(fakeStorage({ "cue.theme": "invalid" })).getState().theme).toBe("system");
});
