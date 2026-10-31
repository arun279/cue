import { type LegacyMigrationResult, migrateLegacyData } from "@/core/migration/legacy-capacitor";
import type { CryptoPort } from "@/core/ports/crypto";
import type { KeyValueStore } from "@/core/ports/kv";
import type { LegacyStore } from "@/core/ports/legacy-store";
import type { PreferenceStorage } from "@/core/ports/preference-storage";
import type { TokenStore } from "@/core/ports/token-store";

const INSTALL_MARKER_KEY = "cue.install-id";

export interface NativeBootDeps {
  readonly tokenStore: TokenStore;
  readonly secure: KeyValueStore;
  readonly bulk: KeyValueStore;
  readonly legacy: LegacyStore;
  readonly preferences: PreferenceStorage;
  readonly newInstallId: () => string;
  readonly digest: CryptoPort["digest"];
}

export interface NativeBootResult {
  readonly purged: boolean;
  readonly migration: LegacyMigrationResult;
}

// expo-secure-store items survive an iOS uninstall and reinstall under the same bundle id.
export async function bootNativeStores(deps: NativeBootDeps): Promise<NativeBootResult> {
  const purged = (await deps.bulk.read(INSTALL_MARKER_KEY)) === null;
  if (purged) {
    void deps.tokenStore
      .clear()
      .then(() => deps.bulk.write(INSTALL_MARKER_KEY, deps.newInstallId()))
      .catch(() => {});
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
