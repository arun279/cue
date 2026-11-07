import type { KeyValueStore } from "@/core/ports/kv";
import { createTokenStore } from "@/core/ports/token-store";
import { bootNativeStores, createInstallTokenStore } from "../src/boot";
import {
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

const appTokenStore = (secure: KeyValueStore, bulk: KeyValueStore) =>
  createInstallTokenStore({ secure, bulk, newInstallId: () => "an-install" });

function deps(options: {
  secure?: Record<string, string>;
  bulk?: Record<string, string>;
  legacy?: Record<string, string>;
}) {
  const secure = memoryKeyValueStore(options.secure);
  const bulk = memoryKeyValueStore(options.bulk);
  return {
    secure,
    tokenStore: appTokenStore(secure, bulk),
    bulk,
    legacy: memoryLegacyStore(options.legacy),
    preferences: memoryPreferenceStorage(),
    digest: async (bytes: Uint8Array<ArrayBuffer>) => bytes,
  };
}

/**
 * The two things that happen before the runtime is built, and the reason they
 * happen in this order: both can change what the token store contains, and
 * getting either wrong is invisible until a user is either signed in as somebody
 * they are not or signed out for no reason they can see.
 */
describe("the native boot", () => {
  it("purges the Keychain on the first launch of a fresh install", async () => {
    // The Keychain outlives an uninstall on iOS, so a reinstalled app can find a
    // token its own install never wrote. An empty bulk store is what a fresh
    // install looks like, which is why the marker has to live there.
    const reinstall = deps({ secure: { "cue.trakt.token": JSON.stringify(TOKEN) } });

    const result = await bootNativeStores(reinstall);

    expect(result.purged).toBe(true);
    expect(await createTokenStore(reinstall.secure).read()).toBeNull();
    expect(reinstall.bulk.values.get("cue.install-id")).toBe("an-install");
  });

  it("finishes a fresh install's boot without waiting on the Keychain, and marks it only once the purge lands", async () => {
    // Marked early, a launch killed before the delete lands would find the old token
    // on its next start and sign the new install in with it.
    const reinstall = deps({ secure: { "cue.trakt.token": JSON.stringify(TOKEN) } });
    let finishDelete = () => {};
    const tokenStore = appTokenStore(
      {
        ...reinstall.secure,
        remove: (key) =>
          new Promise((resolve) => {
            finishDelete = () => resolve(reinstall.secure.remove(key));
          }),
      },
      reinstall.bulk,
    );

    await bootNativeStores({ ...reinstall, tokenStore });

    expect(await tokenStore.read()).toBeNull();
    expect(reinstall.bulk.values.has("cue.install-id")).toBe(false);
    finishDelete();
    await new Promise(setImmediate);
    expect(reinstall.bulk.values.get("cue.install-id")).toBe("an-install");
  });

  it("keeps a legacy token through the launch after one whose purge failed", async () => {
    const upgrade = deps({ legacy: { "cue.trakt.token": JSON.stringify(TOKEN) } });
    const locked = {
      ...upgrade.tokenStore,
      clear: () => Promise.reject(new Error("Keychain unavailable")),
    };
    await bootNativeStores({ ...upgrade, tokenStore: locked }).catch(() => {});

    await bootNativeStores({ ...upgrade, tokenStore: appTokenStore(upgrade.secure, upgrade.bulk) });
    await new Promise(setImmediate);

    expect(await createTokenStore(upgrade.secure).read()).toEqual(TOKEN);
  });

  it("keeps a token saved during a launch whose purge failed", async () => {
    const reinstall = deps({ secure: { "cue.trakt.token": JSON.stringify(TOKEN) } });
    let refused = false;
    const locked = {
      ...reinstall.secure,
      remove: (key: string) => {
        if (refused) return reinstall.secure.remove(key);
        refused = true;
        return Promise.reject(new Error("Keychain unavailable"));
      },
    };
    const tokenStore = appTokenStore(locked, reinstall.bulk);
    await bootNativeStores({ ...reinstall, tokenStore });
    const signedIn = { ...TOKEN, access_token: "signed-in" };
    await tokenStore.write(signedIn);

    await bootNativeStores({
      ...reinstall,
      tokenStore: appTokenStore(reinstall.secure, reinstall.bulk),
    });
    await new Promise(setImmediate);

    expect(await createTokenStore(reinstall.secure).read()).toEqual(signedIn);
  });

  it("leaves a signed-in session alone on every launch after the first", async () => {
    const returning = deps({
      secure: { "cue.trakt.token": JSON.stringify(TOKEN) },
      bulk: { "cue.install-id": "an-earlier-install" },
    });

    const result = await bootNativeStores(returning);

    expect(result.purged).toBe(false);
    expect(await createTokenStore(returning.secure).read()).toEqual(TOKEN);
    expect(returning.bulk.values.get("cue.install-id")).toBe("an-earlier-install");
  });

  it("adopts the legacy token after the purge rather than before it", async () => {
    // Both run on the same launch: the purge clears a Keychain item this install
    // never wrote, and the migration then restores the legacy token. Reversed,
    // an upgrading user is signed out.
    const upgrade = deps({
      secure: { "cue.trakt.token": JSON.stringify({ ...TOKEN, access_token: "stale" }) },
      legacy: { "cue.trakt.token": JSON.stringify(TOKEN) },
    });

    const result = await bootNativeStores(upgrade);

    expect(result.purged).toBe(true);
    expect(result.migration.adoptedToken).toBe(true);
    expect(await createTokenStore(upgrade.secure).read()).toEqual(TOKEN);
  });

  it("stays signed out after relaunching with an adopted legacy token", async () => {
    const upgrade = deps({ legacy: { "cue.trakt.token": JSON.stringify(TOKEN) } });
    await bootNativeStores(upgrade);
    await upgrade.tokenStore.clear();

    const result = await bootNativeStores(upgrade);

    expect(result.migration.adoptedToken).toBe(false);
    expect(await createTokenStore(upgrade.secure).read()).toBeNull();
    expect(upgrade.legacy.values.size).toBe(0);
  });
});
