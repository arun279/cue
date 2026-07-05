import type { Token } from "@domain/model/token";
import type { KeyValueStore } from "@platform/kv";

const TOKEN_KEY = "cue.trakt.token";

/**
 * The Trakt OAuth token behind the platform key-value abstraction.
 * Serialized as JSON so the same token round-trips on either backend; a
 * corrupt/absent entry reads back as `null` rather than throwing.
 */
export interface TokenStore {
  read(): Promise<Token | null>;
  write(token: Token): Promise<void>;
  clear(): Promise<void>;
}

export function createTokenStore(kv: KeyValueStore): TokenStore {
  return {
    async read() {
      const raw = await kv.read(TOKEN_KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as Token;
      } catch {
        return null;
      }
    },
    write: (token) => kv.write(TOKEN_KEY, JSON.stringify(token)),
    clear: () => kv.remove(TOKEN_KEY),
  };
}
