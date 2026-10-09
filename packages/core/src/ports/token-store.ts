import { type Token, tokenSchema } from "../domain/model/token";
import { createJsonStore, type JsonStore } from "./json-store";
import type { KeyValueStore } from "./kv";
import { TOKEN_KEY } from "./storage-keys";

export type TokenStore = JsonStore<Token>;

const SAVE_RETRY_MS = 5_000;

// The Keychain can take over a minute to answer, so the session reads its token from
// memory and saves run one at a time behind it, each retried until it lands or a
// newer save replaces it. A write's promise settles with its own save.
export function createTokenStore(kv: KeyValueStore, retryMs = SAVE_RETRY_MS): TokenStore {
  const stored = createJsonStore<Token>(kv, TOKEN_KEY, (value) => tokenSchema.parse(value));
  let session: Promise<Token | null> | undefined;
  let saving: Promise<void> = Promise.resolve();
  let latest = 0;

  const save = (token: Token | null): Promise<void> => {
    session = Promise.resolve(token);
    const version = ++latest;
    const retry = (): void => {
      if (version === latest) void save(token);
    };
    const attempt = saving.then(() => (token === null ? stored.clear() : stored.write(token)));
    saving = attempt.catch(() => {
      setTimeout(retry, retryMs);
    });
    return attempt;
  };

  const load = (): Promise<Token | null> => {
    const loading = stored.read();
    loading.catch(() => {
      if (session === loading) session = undefined;
    });
    return loading;
  };

  return {
    read: () => (session ??= load()),
    write: save,
    clear: () => save(null),
  };
}
