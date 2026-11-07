import type { KeyValueStore } from "@/core/ports/kv";
import { createTokenStore, type TokenStore } from "@/core/ports/token-store";

const INSTALL_ID_KEY = "cue.install-id";

// Keychain items outlive an uninstall on iOS, and the bulk store does not. Each saved token
// carries the id of the install that saved it, so a token an earlier install left reads as none.
export function createInstallTokenStore({
  secure,
  bulk,
  newInstallId,
}: {
  readonly secure: KeyValueStore;
  readonly bulk: KeyValueStore;
  readonly newInstallId: () => string;
}): TokenStore {
  let install: Promise<string> | undefined;
  const installId = (): Promise<string> => {
    install ??= ownInstallId(bulk, newInstallId).catch((error: unknown) => {
      install = undefined;
      throw error;
    });
    return install;
  };
  return createTokenStore({
    read: async (key) => {
      const [raw, id] = await Promise.all([secure.read(key), installId()]);
      return raw !== null && savedBy(raw) === id ? raw : null;
    },
    write: async (key, value) =>
      secure.write(key, JSON.stringify({ ...JSON.parse(value), install: await installId() })),
    remove: (key) => secure.remove(key),
  });
}

async function ownInstallId(bulk: KeyValueStore, newInstallId: () => string): Promise<string> {
  const saved = await bulk.read(INSTALL_ID_KEY);
  if (saved !== null) return saved;
  const id = newInstallId();
  await bulk.write(INSTALL_ID_KEY, id);
  return id;
}

function savedBy(raw: string): unknown {
  try {
    return JSON.parse(raw)?.install;
  } catch {
    return undefined;
  }
}
