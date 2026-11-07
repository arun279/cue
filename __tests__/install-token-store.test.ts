import { migrateLegacyData } from "@/core/migration/legacy-capacitor";
import type { KeyValueStore } from "@/core/ports/kv";
import { createTokenStore } from "@/core/ports/token-store";
import { createInstallTokenStore } from "../src/install-token-store";
import {
  type MemoryKeyValueStore,
  memoryKeyValueStore,
  memoryLegacyStore,
  memoryPreferenceStorage,
} from "../test/core/support/stores";

const TOKEN = {
  access_token: "access",
  refresh_token: "refresh",
  created_at: 1_700_000_000,
  expires_in: 604_800,
} as const;

/** What a device keeps between launches: the Keychain, which outlives an
 * uninstall on iOS, and the app's own storage, which does not. */
function device(keychain: Record<string, string> = {}) {
  return { secure: memoryKeyValueStore(keychain), bulk: memoryKeyValueStore() };
}

/** One launch's token store, as the composition root builds it. */
const launch = ({ secure, bulk }: { secure: KeyValueStore; bulk: KeyValueStore }) =>
  createInstallTokenStore({ secure, bulk, newInstallId: () => crypto.randomUUID() });

function migrate(
  stores: { secure: MemoryKeyValueStore; bulk: MemoryKeyValueStore },
  legacy: ReturnType<typeof memoryLegacyStore>,
) {
  const tokenStore = launch(stores);
  return migrateLegacyData({
    ...stores,
    tokenStore,
    legacy,
    preferences: memoryPreferenceStorage(),
    digest: async (bytes) => bytes,
  }).then(() => tokenStore);
}

describe("the install's token store", () => {
  it("reads no token that an earlier install left in the Keychain", async () => {
    const reinstall = device({ "cue.trakt.token": JSON.stringify(TOKEN) });

    expect(await launch(reinstall).read()).toBeNull();
  });

  it("reads the token this install saved on every later launch", async () => {
    const phone = device();
    await launch(phone).write(TOKEN);

    expect(await launch(phone).read()).toEqual(TOKEN);
    expect(await launch(phone).read()).toEqual(TOKEN);
  });

  it("keeps a token a sign-in saved when the launch dies right after saving it", async () => {
    // The Keychain still holds an earlier install's token and refuses to delete it.
    const reinstall = device({ "cue.trakt.token": JSON.stringify(TOKEN) });
    let dead = false;
    const keychain = {
      ...reinstall.secure,
      write: (key: string, value: string) =>
        reinstall.secure.write(key, value).then(() => {
          dead = true;
        }),
      remove: () => Promise.reject(new Error("Keychain unavailable")),
    };
    const storage = {
      ...reinstall.bulk,
      write: (key: string, value: string) =>
        dead ? new Promise<void>(() => {}) : reinstall.bulk.write(key, value),
    };
    const first = launch({ secure: keychain, bulk: storage });
    expect(await first.read()).toBeNull();
    const signedIn = { ...TOKEN, access_token: "signed-in" };
    void first.write(signedIn);
    await new Promise(setImmediate);

    expect(await launch(reinstall).read()).toEqual(signedIn);
  });

  it("adopts a legacy token over one an earlier install left, and keeps it", async () => {
    const upgrade = device({
      "cue.trakt.token": JSON.stringify({ ...TOKEN, access_token: "stale" }),
    });

    const tokenStore = await migrate(
      upgrade,
      memoryLegacyStore({ "cue.trakt.token": JSON.stringify(TOKEN) }),
    );

    expect(await tokenStore.read()).toEqual(TOKEN);
    expect(await launch(upgrade).read()).toEqual(TOKEN);
  });

  it("stays signed out after relaunching with an adopted legacy token", async () => {
    const upgrade = device();
    const legacy = memoryLegacyStore({ "cue.trakt.token": JSON.stringify(TOKEN) });
    await (await migrate(upgrade, legacy)).clear();

    const result = await migrateLegacyData({
      ...upgrade,
      tokenStore: launch(upgrade),
      legacy,
      preferences: memoryPreferenceStorage(),
      digest: async (bytes) => bytes,
    });

    expect(result.adoptedToken).toBe(false);
    expect(await createTokenStore(upgrade.secure).read()).toBeNull();
  });
});
