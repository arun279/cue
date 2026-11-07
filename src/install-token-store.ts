import { z } from "zod";
import { tokenSchema } from "@/core/domain/model/token";
import type { KeyValueStore } from "@/core/ports/kv";
import { createTokenStore, type TokenStore } from "@/core/ports/token-store";

const INSTALL_ID_KEY = "cue.install";
// Builds before tokens carried an install id wrote this once their first launch had cleared
// the Keychain, so a token without an id is that install's own only while it is present.
const EARLIER_BUILD_MARKER_KEY = "cue.install-id";

const savedTokenSchema = tokenSchema.extend({ install: z.string().optional() });

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
      const saved = savedToken(raw);
      if (saved?.install === id) return raw;
      if (saved === null || saved.install !== undefined) return null;
      if ((await bulk.read(EARLIER_BUILD_MARKER_KEY)) === null) return null;
      const stamped = JSON.stringify({ ...saved, install: id });
      void secure.write(key, stamped).catch(() => {});
      return stamped;
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

function savedToken(raw: string | null): z.infer<typeof savedTokenSchema> | null {
  if (raw === null) return null;
  try {
    const parsed = savedTokenSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
