import { AuthGate } from "@app/AuthGate";
import { createAuthStore } from "@app/auth/create-auth-store";
import { TRAKT_CLIENT_ID } from "@app/config";
import { requestPersistentStorage } from "@app/persist";
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryClient, queryPersister } from "@app/query-client";
import { createKeyValueStore } from "@platform/kv";
import { isNativePlatform } from "@platform/platform";
import { createTokenStore } from "@platform/token-store";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactElement, useEffect } from "react";

// One key-value backend for the whole session (web: IndexedDB, native:
// Preferences), backing the token store the auth store wires.
const native = isNativePlatform();
const kv = createKeyValueStore(native);
const tokenStore = createTokenStore(kv);
const redirectUri = `${globalThis.location.origin}/auth/callback`;
const authStore = createAuthStore({
  tokenStore,
  clientId: TRAKT_CLIENT_ID,
  redirectUri,
  redirect: (url) => globalThis.location.assign(url),
  native,
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
      <AuthGate store={authStore} stores={{ tokenStore, kv, redirectUri }} />
    </PersistQueryClientProvider>
  );
}
