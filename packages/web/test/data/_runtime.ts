import { createCueRuntime, type RuntimeDeps } from "@cue/core/app/create-runtime";
import type { KeyValueStore } from "@cue/core/ports/kv";
import type { TokenStore } from "@cue/core/ports/token-store";
import type { CueRuntime } from "@cue/core/runtime/runtime";

/** A `KeyValueStore` over a Map, so a suite can seed it and read it back. */
export function memoryKv(
  seed: Record<string, string> = {},
): KeyValueStore & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(seed));
  return {
    values,
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}

const noopTokenStore: TokenStore = {
  read: async () => null,
  write: async () => undefined,
  clear: async () => undefined,
};

/**
 * A real composition root over inert dependencies: everything a suite about the
 * runtime's own behavior needs, with only the parts it is testing supplied.
 */
export function buildRuntime(overrides: Partial<RuntimeDeps> = {}): Promise<CueRuntime> {
  return createCueRuntime({
    token: {
      access_token: "access",
      refresh_token: "refresh",
      created_at: Math.floor(Date.now() / 1000),
      expires_in: 604_800,
    },
    kv: memoryKv(),
    tokenStore: noopTokenStore,
    redirectUri: "https://cue.test/auth/callback",
    clientId: "test-client",
    endSession: async () => undefined,
    clearPersistedCaches: async () => undefined,
    clearLocalPreferences: () => undefined,
    ...overrides,
  });
}
