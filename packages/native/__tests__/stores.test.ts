import { createPrefsStore } from "@cue/core/prefs/prefs-store";
import { bulkBacking, secureStoreModule } from "./support/native-stores";

jest.mock("expo-secure-store", () => require("./support/native-stores").secureStoreModule);

import {
  bulkStore,
  clearLocalPreferences,
  preferenceStorage,
  secureStore,
} from "../src/platform/stores";

it("keeps the token in a Keychain item that never moves to another device through a backup", async () => {
  const save = jest.spyOn(secureStoreModule, "setItemAsync");

  await secureStore.write("cue.trakt.token", "token");

  expect(save).toHaveBeenCalledWith("cue.trakt.token", "token", {
    keychainAccessible: secureStoreModule.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
});

/**
 * The namespace split. Preferences and the durable state share one database,
 * and every durable key is `cue.`-prefixed, so a
 * sign-out that cleared `cue.` would take the write queue, the freshness
 * baseline and the install marker with it. Losing the install marker is the
 * worst of those: the next launch would look like a fresh install to the
 * reinstall purge, which would then clear the token.
 */
describe("what sign-out's preference clear can reach", () => {
  beforeEach(() => {
    bulkBacking.values.clear();
  });

  it("cannot reach the durable write queue or the install marker, which share its store", async () => {
    await bulkStore.write("cue.write-queue", '[{"id":"op-1"}]');
    await bulkStore.write("cue.install-id", "an-install");
    preferenceStorage.setItem("cue.theme", "dark");

    const prefs = createPrefsStore(preferenceStorage);
    prefs.getState().setMoviesEnabled(false);
    clearLocalPreferences(prefs);

    expect(preferenceStorage.getItem("cue.theme")).toBeNull();
    expect(prefs.getState()).toMatchObject({ theme: "system", moviesEnabled: true });
    expect(await bulkStore.read("cue.write-queue")).toBe('[{"id":"op-1"}]');
    expect(await bulkStore.read("cue.install-id")).toBe("an-install");
  });

  it("keeps a preference out of a `cue.` prefix scan of the bulk store", () => {
    preferenceStorage.setItem("cue.theme", "dark");

    expect([...bulkBacking.values.keys()]).toEqual(["pref.cue.theme"]);
  });
});
