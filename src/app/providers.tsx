import { AuthGate } from "@app/AuthGate";
import { createAuthStore } from "@app/auth/create-auth-store";
import { requestPersistentStorage } from "@app/persist";
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryClient, queryPersister } from "@app/query-client";
import { createCredsStore } from "@platform/creds-store";
import { createKeyValueStore } from "@platform/kv";
import { isNativePlatform } from "@platform/platform";
import { createTokenStore } from "@platform/token-store";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactElement, useEffect } from "react";

// One key-value backend for the whole session (web: IndexedDB, native:
// Preferences), shared by the token + creds stores the auth store wires.
const kv = createKeyValueStore(isNativePlatform());
const authStore = createAuthStore({
  tokenStore: createTokenStore(kv),
  credsStore: createCredsStore(kv),
  redirectUri: `${globalThis.location.origin}/auth/callback`,
  redirect: (url) => globalThis.location.assign(url),
});

/**
 * Composition root: the persisted Query cache wraps the auth
 * gate so a restored cache paints before the router's first fetch resolves.
 * `maxAge` is decoupled from `staleTime` in `query-client.ts`.
 */
export function AppProviders(): ReactElement {
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: PERSIST_MAX_AGE,
        buster: PERSIST_BUSTER,
      }}
    >
      <AuthGate store={authStore} />
    </PersistQueryClientProvider>
  );
}
