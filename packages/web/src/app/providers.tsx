import { AuthGate } from "@app/AuthGate";
import { TRAKT_BASE_OVERRIDE, TRAKT_CLIENT_ID } from "@app/config";
import { requestPersistentStorage } from "@app/persist";
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
  queryClient,
  queryPersister,
  shouldDehydrateQuery,
} from "@app/query-client";
import { createAuthStore } from "@cue/core/auth/create-auth-store";
import { AppVersionProvider } from "@cue/core/ports/app-version";
import { AppVisibilityProvider } from "@cue/core/ports/app-visibility";
import { HapticsProvider } from "@cue/core/ports/haptics";
import { NetworkProvider } from "@cue/core/ports/network";
import { RemindersProvider } from "@cue/core/ports/reminders";
import { createTokenStore } from "@cue/core/ports/token-store";
import { PrefsProvider } from "@cue/core/prefs/prefs-store";
import { webAppVisibility } from "@platform/app-visibility";
import { webCrypto } from "@platform/crypto";
import { webHaptics } from "@platform/haptics";
import { createKeyValueStore } from "@platform/kv";
import { webNetwork } from "@platform/network";
import { sessionRedirectHandoff } from "@platform/redirect-handoff";
import { webReminders } from "@platform/reminders";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { prefsStore } from "@ui/prefs/prefs-store";
import { type ReactElement, useEffect } from "react";
import { version } from "../../package.json";

const kv = createKeyValueStore();
const tokenStore = createTokenStore(kv);
const redirectUri = `${globalThis.location.origin}/auth/callback`;
const authStore = createAuthStore({
  crypto: webCrypto,
  tokenStore,
  clientId: TRAKT_CLIENT_ID,
  redirectUri,
  redirect: (url) => globalThis.location.assign(url),
  redirectHandoff: sessionRedirectHandoff,
  native: false,
  traktBaseUrl: TRAKT_BASE_OVERRIDE,
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
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      <PrefsProvider value={prefsStore}>
        <AppVisibilityProvider value={webAppVisibility}>
          <NetworkProvider value={webNetwork}>
            <HapticsProvider value={webHaptics}>
              <RemindersProvider value={webReminders}>
                <AppVersionProvider value={version}>
                  <AuthGate store={authStore} stores={{ tokenStore, kv, redirectUri }} />
                </AppVersionProvider>
              </RemindersProvider>
            </HapticsProvider>
          </NetworkProvider>
        </AppVisibilityProvider>
      </PrefsProvider>
    </PersistQueryClientProvider>
  );
}
