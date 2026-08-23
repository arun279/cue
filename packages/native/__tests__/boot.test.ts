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
  return {
    secure: memoryKeyValueStore(options.secure),
    bulk: memoryKeyValueStore(options.bulk),
    legacy: memoryKeyValueStore(options.legacy) as LegacyStore & MemoryKeyValueStore,
    preferences: memoryPreferenceStorage(),
    newInstallId: () => "an-install",
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

  it("adopts the Capacitor build's token, after the purge rather than before it", async () => {
    // Both run on the same launch: the purge clears a Keychain item this install
    // never wrote, and the migration then puts back the one the Capacitor build
    // did write. Reversed, an upgrading user is signed out.
    const upgrade = deps({
      secure: { "cue.trakt.token": JSON.stringify({ ...TOKEN, access_token: "stale" }) },
      legacy: { "cue.trakt.token": JSON.stringify(TOKEN) },
    });

    const result = await bootNativeStores(upgrade);

    expect(result.purged).toBe(true);
    expect(result.migration.adoptedToken).toBe(true);
    expect(await createTokenStore(upgrade.secure).read()).toEqual(TOKEN);
  });

  it("installs the Web Crypto surface the shared OAuth code is written against", async () => {
    await bootNativeStores(deps({}));

    expect(typeof globalThis.btoa).toBe("function");
    expect(typeof globalThis.crypto.getRandomValues).toBe("function");
    expect(typeof globalThis.crypto.subtle.digest).toBe("function");
  });
});
