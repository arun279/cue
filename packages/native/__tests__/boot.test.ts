import type { LegacyStore } from "@cue/core/ports/legacy-store";
import { createTokenStore } from "@cue/core/ports/token-store";
import {
  type MemoryKeyValueStore,
  memoryKeyValueStore,
  memoryPreferenceStorage,
} from "../../core/test/support/stores";
import { bootNativeStores } from "../src/boot";

const TOKEN = {
  access_token: "access",
  refresh_token: "refresh",
  created_at: 1_700_000_000,
  expires_in: 604_800,
} as const;

function deps(options: {
  secure?: Record<string, string>;
  bulk?: Record<string, string>;
  legacy?: Record<string, string>;
}) {
  const secure = memoryKeyValueStore(options.secure);
  return {
    secure,
    tokenStore: createTokenStore(secure),
    bulk: memoryKeyValueStore(options.bulk),
    legacy: memoryKeyValueStore(options.legacy) as LegacyStore & MemoryKeyValueStore,
    preferences: memoryPreferenceStorage(),
    newInstallId: () => "an-install",
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
    const tokenStore = createTokenStore({
      ...reinstall.secure,
      remove: (key) =>
        new Promise((resolve) => {
          finishDelete = () => resolve(reinstall.secure.remove(key));
        }),
    });

    await bootNativeStores({ ...reinstall, tokenStore });

    expect(await tokenStore.read()).toBeNull();
    expect(reinstall.bulk.values.has("cue.install-id")).toBe(false);
    finishDelete();
    await new Promise(setImmediate);
    expect(reinstall.bulk.values.get("cue.install-id")).toBe("an-install");
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
    expect(upgrade.legacy.values.get("cue.trakt.token")).toBe(JSON.stringify(TOKEN));
  });
});
