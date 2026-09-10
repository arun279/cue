import "fake-indexeddb/auto";
import { createKeyValueStore } from "@platform/kv";
import { clearLocalPreferences, preferenceStorage } from "@ui/prefs/preference-storage";
import { clear } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";
import { describeKeyValueStore } from "../../../core/test/support/kv-contract";

describeKeyValueStore({
  name: "the web store (idb-keyval over IndexedDB)",
  open: () => createKeyValueStore(),
  reset: () => clear(),
});

describe("what sign-out's preference clear can reach", () => {
  beforeEach(async () => {
    await clear();
    localStorage.clear();
  });

  it("cannot reach the durable write queue, which lives in a different store", async () => {
    const kv = createKeyValueStore();
    await kv.write("cue.write-queue", '[{"id":"op-1"}]');
    preferenceStorage.setItem("cue.theme", "dark");

    clearLocalPreferences();

    expect(preferenceStorage.getItem("cue.theme")).toBeNull();
    expect(await kv.read("cue.write-queue")).toBe('[{"id":"op-1"}]');
  });
});
