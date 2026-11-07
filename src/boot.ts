import { type LegacyMigrationResult, migrateLegacyData } from "@/core/migration/legacy-capacitor";
import type { CryptoPort } from "@/core/ports/crypto";
import type { KeyValueStore } from "@/core/ports/kv";
import type { LegacyStore } from "@/core/ports/legacy-store";
import type { PreferenceStorage } from "@/core/ports/preference-storage";
import { TOKEN_KEY } from "@/core/ports/storage-keys";
import { createTokenStore, type TokenStore } from "@/core/ports/token-store";

const INSTALL_MARKER_KEY = "cue.install-id";

export interface NativeBootDeps {
  readonly tokenStore: TokenStore;
  readonly secure: KeyValueStore;
  readonly bulk: KeyValueStore;
  readonly legacy: LegacyStore;
  readonly preferences: PreferenceStorage;
  readonly digest: CryptoPort["digest"];
}

export interface NativeBootResult {
  readonly purged: boolean;
  readonly migration: LegacyMigrationResult;
}

// The install marker says the Keychain holds no token from before this install, so it is
// written once this install has deleted or saved the token. A sign-in after a purge that
// failed replaces the old token, and marks the install as surely as the purge would have.
export function createInstallTokenStore({
  secure,
  bulk,
  newInstallId,
}: {
  readonly secure: KeyValueStore;
  readonly bulk: KeyValueStore;
  readonly newInstallId: () => string;
}): TokenStore {
  const markInstall = async (): Promise<void> => {
    if ((await bulk.read(INSTALL_MARKER_KEY)) === null) {
      await bulk.write(INSTALL_MARKER_KEY, newInstallId());
    }
  };
  return createTokenStore({
    read: (key) => secure.read(key),
    write: (key, value) => secure.write(key, value).then(markInstall),
    remove: (key) => secure.remove(key).then(markInstall),
  });
}

// expo-secure-store items survive an iOS uninstall and reinstall under the same bundle id.
export async function bootNativeStores(deps: NativeBootDeps): Promise<NativeBootResult> {
  const purged = (await deps.bulk.read(INSTALL_MARKER_KEY)) === null;
  if (purged) {
    const adopting = (await deps.legacy.read(TOKEN_KEY)) !== null;
    const purge = deps.tokenStore.clear();
    // A legacy token adopted before the purge lands would be purged again on the next launch.
    if (adopting) await purge;
    else void purge.catch(() => {});
  }

  const migration = await migrateLegacyData({
    legacy: deps.legacy,
    tokenStore: deps.tokenStore,
    secure: deps.secure,
    bulk: deps.bulk,
    preferences: deps.preferences,
    digest: deps.digest,
  });

  return { purged, migration };
}
