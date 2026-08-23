/**
 * Every `KeyValueStore` backend that exists today, against the one contract.
 *
 * The web store runs on a real IndexedDB implementation rather than a Map
 * standing in for idb-keyval, because the properties the contract cares about
 * (a 200KB value kept whole, an emoji kept as itself, a key gone after a
 * removal) belong to the database, not to the wrapper. The Capacitor store is
 * the one backend with no in-process implementation to run, so it keeps its
 * Map: what is under test there is the shape of the bridge calls.
 *
 * `packages/native`'s backends join this list by handing the same suite their
 * own `KeyValueBacking`, which is why the assertions live in `@cue/core`'s test
 * tree rather than here.
 */

import "fake-indexeddb/auto";
import { createKeyValueStore } from "@platform/kv";
import { clearLocalPreferences, preferenceStorage } from "@ui/prefs/preference-storage";
import { clear } from "idb-keyval";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeKeyValueStore } from "../../../core/test/support/kv-contract";

const nativeBacking = vi.hoisted(() => new Map<string, string>());

vi.mock("@capacitor/preferences", async () => {
  const { createPreferencesMock } = await import("../support/capacitor-preferences-mock");
  return createPreferencesMock(nativeBacking);
});

describeKeyValueStore({
  name: "the web store (idb-keyval over IndexedDB)",
  open: () => createKeyValueStore(false),
  reset: () => clear(),
});

describeKeyValueStore({
  name: "the native store (Capacitor Preferences)",
  open: () => createKeyValueStore(true),
  reset: async () => {
    nativeBacking.clear();
  },
});

describe("what sign-out's preference clear can reach", () => {
  beforeEach(async () => {
    await clear();
    localStorage.clear();
  });

  it("cannot reach the durable write queue, which lives in a different store", async () => {
    const kv = createKeyValueStore(false);
    await kv.write("cue.write-queue", '[{"id":"op-1"}]');
    preferenceStorage.setItem("cue.theme", "dark");

    clearLocalPreferences();

    expect(preferenceStorage.getItem("cue.theme")).toBeNull();
    expect(await kv.read("cue.write-queue")).toBe('[{"id":"op-1"}]');
  });
});
