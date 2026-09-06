import { describeKeyValueStore } from "../../core/test/support/kv-contract";
import { bulkBacking, secureBacking } from "./support/native-stores";

// Both factories are hoisted above the imports, so each reaches its fake
// through `require` rather than through a binding that does not exist yet, and
// the adapters are loaded the same way, after the mocks are in place.
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));
jest.mock("expo-secure-store", () => require("./support/native-stores").secureStoreModule);

const { bulkStore, clearLocalPreferences, preferenceStorage, secureStore } =
  require("../src/platform/stores") as typeof import("../src/platform/stores");

/**
 * The two native backends against the one contract every `KeyValueStore` has to
 * satisfy, the same suite the web store and the Capacitor store already run.
 * This seam carries the OAuth token and the durable write queue, so a backend
 * that truncates a long value, mangles a non-latin1 one, throws instead of
 * answering null or forgets across a restart loses a user's writes silently.
 */
describeKeyValueStore({
  name: "the native bulk store (expo-sqlite/kv-store)",
  open: () => bulkStore,
  reset: () => {
    bulkBacking.values.clear();
    return Promise.resolve();
  },
});

describeKeyValueStore({
  name: "the native token store (expo-secure-store)",
  open: () => secureStore,
  reset: () => {
    secureBacking.clear();
    return Promise.resolve();
  },
});

/**
 * The namespace split, which exists only on this target. On the web,
 * preferences and the durable state are in physically different stores; here
 * they share one database, and every durable key is `cue.`-prefixed, so a
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

    clearLocalPreferences();

    expect(preferenceStorage.getItem("cue.theme")).toBeNull();
    expect(await bulkStore.read("cue.write-queue")).toBe('[{"id":"op-1"}]');
    expect(await bulkStore.read("cue.install-id")).toBe("an-install");
  });

  it("keeps a preference out of a `cue.` prefix scan of the bulk store", () => {
    preferenceStorage.setItem("cue.theme", "dark");

    expect([...bulkBacking.values.keys()]).toEqual(["pref.cue.theme"]);
  });
});
