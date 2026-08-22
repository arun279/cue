import { AuthGate } from "@app/AuthGate";
import { createAuthStore } from "@app/auth/create-auth-store";
import { TRAKT_CLIENT_ID } from "@app/config";
import { requestPersistentStorage } from "@app/persist";
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
  queryClient,
  queryPersister,
  shouldDehydrateQuery,
} from "@app/query-client";
import { router } from "@app/router";
import { getNativeAppVersion } from "@platform/app-version";
import { bindHardwareBack } from "@platform/back-button";
import { createNativeHaptics } from "@platform/haptics";
import { createKeyValueStore } from "@platform/kv";
import { isNativePlatform } from "@platform/platform";
import { applyStatusBarTheme } from "@platform/status-bar";
import { createTokenStore } from "@platform/token-store";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { usePrefs } from "@ui/prefs/prefs-store";
import { AppVersionProvider } from "@ui/runtime/app-version";
import { HapticsProvider } from "@ui/runtime/haptics";
import { useThemeStore } from "@ui/theme/theme-store";
import { type ReactElement, useEffect, useState } from "react";
import { version } from "../../package.json";

// One key-value backend for the whole session (web: IndexedDB, native:
// Preferences), backing the token store the auth store wires.
const native = isNativePlatform();
const kv = createKeyValueStore(native);
const tokenStore = createTokenStore(kv);
// The tactile seam, built once: silent on web, and on native gated at fire time
// on the Settings "Haptics" toggle alone. Both platforms honour their own
// system haptics settings underneath, so nothing else here second-guesses them.
const haptics = createNativeHaptics(() => usePrefs.getState().hapticsEnabled);
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
  const [appVersion, setAppVersion] = useState(native ? "" : version);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Native platform garnish (all silent no-ops on web): read the shipped app
  // identity, match the status bar to the active theme and re-match on every
  // toggle, and map Android hardware Back to the router (exit at a root tab).
  // The router uses browser history, so iOS edge-swipe-back maps to the router
  // natively.
  useEffect(() => {
    void getNativeAppVersion()
      .then((nativeAppVersion) => {
        if (nativeAppVersion !== null) setAppVersion(nativeAppVersion);
      })
      .catch((cause: unknown) => {
        // "Unknown" keeps a native bridge failure from looking like a real version.
        setAppVersion("Unknown");
        console.error("Failed to read native app version", cause);
      });
    applyStatusBarTheme(useThemeStore.getState().theme);
    const unsubscribeTheme = useThemeStore.subscribe((state) => applyStatusBarTheme(state.theme));
    const unbindBack = bindHardwareBack(() => {
      if (!router.history.canGoBack()) return false;
      router.history.back();
      return true;
    });
    return () => {
      unsubscribeTheme();
      unbindBack();
    };
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
      <HapticsProvider value={haptics}>
        <AppVersionProvider value={appVersion}>
          <AuthGate store={authStore} stores={{ tokenStore, kv, redirectUri }} />
        </AppVersionProvider>
      </HapticsProvider>
    </PersistQueryClientProvider>
  );
}
