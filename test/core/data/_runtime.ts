import type { TokenStore } from "@/core/ports/token-store";
import { createCueRuntime, type RuntimeDeps } from "@/core/runtime/create-runtime";
import type { CueRuntime } from "@/core/runtime/runtime";
import { memoryKeyValueStore } from "../support/stores";
import { SESSION } from "../trakt-fake/account.ts";

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
      ...SESSION,
      created_at: Math.floor(Date.now() / 1000),
      expires_in: 604_800,
    },
    newId: () => "test-op-id",
    kv: memoryKeyValueStore(),
    tokenStore: noopTokenStore,
    redirectUri: "https://cue.test/auth/callback",
    clientId: "test-client",
    endSession: async () => undefined,
    clearPersistedCaches: async () => undefined,
    clearLocalPreferences: () => undefined,
    ...overrides,
  });
}
