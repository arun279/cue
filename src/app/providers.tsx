import { AuthGate } from "@app/AuthGate";
import { createAuthStore } from "@app/auth/create-auth-store";
import { TRAKT_CLIENT_ID } from "@app/config";
import { requestPersistentStorage } from "@app/persist";
import { PERSIST_BUSTER, PERSIST_MAX_AGE, queryClient, queryPersister } from "@app/query-client";
import { router } from "@app/router";
import { bindHardwareBack } from "@platform/back-button";
import { createNativeHaptics } from "@platform/haptics";
import { createKeyValueStore } from "@platform/kv";
import { isNativePlatform } from "@platform/platform";
import { applyStatusBarTheme } from "@platform/status-bar";
import { createTokenStore } from "@platform/token-store";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { usePrefs } from "@ui/prefs/prefs-store";
import { HapticsProvider } from "@ui/runtime/haptics";
import { useThemeStore } from "@ui/theme/theme-store";
import { type ReactElement, useEffect } from "react";

// One key-value backend for the whole session (web: IndexedDB, native:
// Preferences), backing the token store the auth store wires.
const native = isNativePlatform();
const kv = createKeyValueStore(native);
const tokenStore = createTokenStore(kv);
// The tactile seam, built once: silent on web, and on native
// gated at fire time on the Settings "Haptics" toggle + prefers-reduced-motion.
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
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Native platform garnish (all silent no-ops on web): match the status bar to
  // the active theme and re-match on every toggle, and map Android hardware Back
  // to the router (exit at a root tab). The router uses browser history, so iOS
  // edge-swipe-back maps to the router natively.
  useEffect(() => {
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
      }}
    >
      <HapticsProvider value={haptics}>
        <AuthGate store={authStore} stores={{ tokenStore, kv, redirectUri }} />
      </HapticsProvider>
    </PersistQueryClientProvider>
  );
}
