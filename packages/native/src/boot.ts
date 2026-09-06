import {
  type LegacyMigrationResult,
  migrateLegacyCapacitorData,
} from "@cue/core/migration/legacy-capacitor";
import type { KeyValueStore } from "@cue/core/ports/kv";
import type { LegacyStore } from "@cue/core/ports/legacy-store";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { createTokenStore } from "@cue/core/ports/token-store";
import { installWebCrypto } from "./crypto";

/** The marker that says this install has launched before. It lives in the bulk
 * store, which is the one an uninstall clears, and under `cue.` rather than
 * `pref.` so a sign-out's preference clear cannot reach it. */
const INSTALL_MARKER_KEY = "cue.install-id";

export interface NativeBootDeps {
  readonly secure: KeyValueStore;
  readonly bulk: KeyValueStore;
  readonly legacy: LegacyStore;
  readonly preferences: PreferenceStorage;
  readonly newInstallId: () => string;
}

export interface NativeBootResult {
  /** True when this launch was the first of a fresh install and the Keychain was
   * purged. */
  readonly purged: boolean;
  readonly migration: LegacyMigrationResult;
}

/**
 * Everything that has to happen before the runtime is built, in order, because
 * both steps can change what the token store contains.
 *
 * 1. **The reinstall purge.** Expo documents that data stored with
 *    `expo-secure-store` survives an uninstall when the app is reinstalled with
 *    the same bundle id on iOS, while on Android it does not. Without this, a
 *    user who deletes Cue and reinstalls it comes back apparently signed in,
 *    with a stale token and none of their local state. An empty bulk store is
 *    what a fresh install looks like, so the absence of the marker is the
 *    signal, and the marker has to live there rather than in the Keychain for
 *    exactly the same reason.
 * 2. **The Capacitor migration.** Pure, over the legacy port, so every branch of
 *    it is a unit test rather than a device session.
 */
export async function bootNativeStores(deps: NativeBootDeps): Promise<NativeBootResult> {
  installWebCrypto(globalThis as unknown as Record<string, unknown>);

  const purged = (await deps.bulk.read(INSTALL_MARKER_KEY)) === null;
  if (purged) {
    await createTokenStore(deps.secure).clear();
    await deps.bulk.write(INSTALL_MARKER_KEY, deps.newInstallId());
  }

  const migration = await migrateLegacyCapacitorData({
    legacy: deps.legacy,
    tokenStore: createTokenStore(deps.secure),
    bulk: deps.bulk,
    preferences: deps.preferences,
  });

  return { purged, migration };
}
