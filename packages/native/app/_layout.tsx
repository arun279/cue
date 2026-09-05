import { createAuthStore } from "@cue/core/auth/create-auth-store";
import { type AuthStore, AuthStoreProvider, useAuth } from "@cue/core/auth/store";
import { AppVersionProvider } from "@cue/core/ports/app-version";
import { AppVisibilityProvider } from "@cue/core/ports/app-visibility";
import { HapticsProvider } from "@cue/core/ports/haptics";
import { NetworkProvider } from "@cue/core/ports/network";
import { RemindersProvider } from "@cue/core/ports/reminders";
import { createTokenStore } from "@cue/core/ports/token-store";
import { createPrefsStore, PrefsProvider } from "@cue/core/prefs/prefs-store";
import { PERSIST_BUSTER, PERSIST_MAX_AGE } from "@cue/core/runtime/query-cache";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { randomUUID } from "expo-crypto";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactElement, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import { bootNativeStores } from "../src/boot";
import { NATIVE_REDIRECT_URI, TRAKT_BASE_OVERRIDE, TRAKT_CLIENT_ID } from "../src/config";
import { nativeAppVersion } from "../src/platform/app-version";
import { nativeAppVisibility } from "../src/platform/app-visibility";
import { createNativeHaptics } from "../src/platform/haptics";
import { legacyCapacitorStore } from "../src/platform/legacy-store";
import { createNativeNetwork } from "../src/platform/network";
import {
  clearPersistedCaches,
  queryClient,
  queryPersister,
  shouldDehydrateQuery,
} from "../src/platform/query-persister";
import { createNativeReminders } from "../src/platform/reminders";
import { useScreenReader } from "../src/platform/screen-reader";
import {
  bulkStore,
  clearLocalPreferences,
  preferenceStorage,
  secureStore,
} from "../src/platform/stores";
import { Onboarding } from "../src/screens/Onboarding";
import { RuntimeBoot } from "../src/screens/RuntimeBoot";
import { AppIdle } from "../src/ui/AppIdle";
import { SnackbarHost } from "../src/ui/SnackbarHost";
import { useCueFonts } from "../src/ui/type";

/**
 * The native composition root. It is the only file that knows both which
 * implementation fills each port and which app is being built; everything below
 * it is `@cue/core`, unchanged, and the screens.
 *
 * Held from the first frame, because the boot below can change what the token
 * store contains and painting onboarding before that resolves would show a
 * signed-in user a sign-in screen. A rejection is swallowed: the splash module
 * throws when there is no splash to hold, which is not a reason to fail a launch.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});

const prefsStore = createPrefsStore(preferenceStorage);
const tokenStore = createTokenStore(secureStore);
// Read at fire time rather than captured, exactly as the web build reads it.
const haptics = createNativeHaptics(() => prefsStore.getState().hapticsEnabled);
const reminders = createNativeReminders();
const network = createNativeNetwork();

/**
 * The purge, the migration, and only then the auth store.
 *
 * The order is the point: `createAuthStore` reads the persisted token the
 * instant it is built, so building it before the migration has adopted a legacy
 * token would drop an upgrading user onto onboarding, and building it before the
 * reinstall purge would sign a reinstalling user in with a Keychain item their
 * new install never wrote.
 */
function useNativeSession(): AuthStore | null {
  const [authStore, setAuthStore] = useState<AuthStore | null>(null);

  useEffect(() => {
    let alive = true;
    void bootNativeStores({
      secure: secureStore,
      bulk: bulkStore,
      legacy: legacyCapacitorStore,
      preferences: preferenceStorage,
      newInstallId: randomUUID,
    })
      .catch(() => {})
      .then(() => {
        if (!alive) return;
        setAuthStore(
          createAuthStore({
            tokenStore,
            clientId: TRAKT_CLIENT_ID,
            redirectUri: NATIVE_REDIRECT_URI,
            // A device has no page navigation, so the two members that exist for
            // one are stated rather than inherited: nothing redirects, and there
            // is no handoff to stash across a navigation that never happens.
            redirect: () => {},
            redirectHandoff: { read: () => null, write: () => {}, clear: () => {} },
            native: true,
            traktBaseUrl: TRAKT_BASE_OVERRIDE,
          }),
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  return authStore;
}

/** Everything the runtime takes that this build decides, assembled once: the
 * boot component then knows only how to draw its three states. */
const runtimeDeps = {
  tokenStore,
  kv: bulkStore,
  redirectUri: NATIVE_REDIRECT_URI,
  clientId: TRAKT_CLIENT_ID,
  apiBaseUrl: TRAKT_BASE_OVERRIDE,
  clearPersistedCaches,
  clearLocalPreferences,
};

/** Until a token is stored the app is onboarding; once connected it is the
 * routed shell wrapped in the authenticated runtime. */
function Gate(): ReactElement {
  const phase = useAuth((s) => s.phase);

  if (phase === "connected") {
    return (
      <RuntimeBoot deps={runtimeDeps}>
        <View style={styles.root}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* Presented from the root, over the tab bar, so it always dismisses
                back to exactly where the user was rather than into whichever tab
                happened to be selected. */}
            <Stack.Screen name="(account)" options={{ presentation: "fullScreenModal" }} />
          </Stack>
          {/* The root host. Every presentation that can raise a snack mounts one
              of its own, and only the topmost draws. */}
          <SnackbarHost placement="root" />
          <AppIdle />
        </View>
      </RuntimeBoot>
    );
  }
  if (phase === "loading") return <View testID="auth-loading" />;
  return <Onboarding />;
}

export default function RootLayout(): ReactElement {
  useScreenReader();
  const authStore = useNativeSession();
  const fontsSettled = useCueFonts();

  useEffect(() => {
    if (authStore !== null && fontsSettled) void SplashScreen.hideAsync().catch(() => {});
  }, [authStore, fontsSettled]);

  // Nothing to paint until the stores and the faces are settled, and the splash
  // is still up. "Settled" rather than "loaded" for the faces: one that will not
  // load falls back to the platform's own, which is not a reason to hold here.
  if (authStore === null || !fontsSettled) return <View testID="boot-hold" />;

  return (
    // The metrics the native side already knows, so the first frame is the app
    // rather than nothing.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
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
          <AppVisibilityProvider value={nativeAppVisibility}>
            <NetworkProvider value={network}>
              <HapticsProvider value={haptics}>
                <RemindersProvider value={reminders}>
                  <AppVersionProvider value={nativeAppVersion}>
                    <AuthStoreProvider value={authStore}>
                      {/* Declarative, and "auto" follows the system appearance the
                        app config already declares. The theme store drives it
                        once that store has a port of its own. */}
                      <StatusBar style="auto" />
                      <Gate />
                    </AuthStoreProvider>
                  </AppVersionProvider>
                </RemindersProvider>
              </HapticsProvider>
            </NetworkProvider>
          </AppVisibilityProvider>
        </PrefsProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
