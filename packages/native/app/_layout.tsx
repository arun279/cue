import { createAuthStore } from "@cue/core/auth/create-auth-store";
import { type AuthStore, AuthStoreProvider, useAuth } from "@cue/core/auth/store";
import { useActivitiesPoll } from "@cue/core/hooks/useActivitiesPoll";
import { useEpisodeReminders } from "@cue/core/hooks/useEpisodeReminders";
import { AppVersionProvider } from "@cue/core/ports/app-version";
import { AppVisibilityProvider } from "@cue/core/ports/app-visibility";
import { HapticsProvider } from "@cue/core/ports/haptics";
import { NetworkProvider } from "@cue/core/ports/network";
import { RemindersProvider } from "@cue/core/ports/reminders";
import { createTokenStore } from "@cue/core/ports/token-store";
import { createPrefsStore, PrefsProvider } from "@cue/core/prefs/prefs-store";
import { PERSIST_BUSTER, PERSIST_MAX_AGE } from "@cue/core/runtime/query-cache";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactElement, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import { bootNativeStores } from "../src/boot";
import { NATIVE_REDIRECT_URI, TRAKT_BASE_OVERRIDE, TRAKT_CLIENT_ID } from "../src/config";
import { nativeCrypto } from "../src/crypto";
import { nativeAppVersion } from "../src/platform/app-version";
import { nativeAppVisibility } from "../src/platform/app-visibility";
import { createNativeHaptics } from "../src/platform/haptics";
import { legacyStore } from "../src/platform/legacy-store";
import { createNativeNetwork } from "../src/platform/network";
import {
  clearPersistedCaches,
  queryClient,
  queryPersister,
  shouldDehydrateQuery,
} from "../src/platform/query-persister";
import { createNativeReminders, useOpenTappedReminder } from "../src/platform/reminders";
import { useScreenReader } from "../src/platform/screen-reader";
import { useSplashRelease } from "../src/platform/splash";
import {
  bulkStore,
  clearLocalPreferences,
  preferenceStorage,
  secureStore,
} from "../src/platform/stores";
import { useAppearance } from "../src/screens/account/ThemeControl";
import { Onboarding } from "../src/screens/Onboarding";
import { RuntimeBoot } from "../src/screens/RuntimeBoot";
import { AppIdle } from "../src/ui/AppIdle";
import { Marker } from "../src/ui/Marker";
import { useNavigationTheme } from "../src/ui/navigation-theme";
import { useResponseTiming } from "../src/ui/response-timing";
import { SnackbarHost } from "../src/ui/SnackbarHost";
import { TEST_IDS } from "../src/ui/test-ids";
import { useFontsSettled } from "../src/ui/type";

void SplashScreen.preventAutoHideAsync().catch(() => {});

const prefsStore = createPrefsStore(preferenceStorage);
const tokenStore = createTokenStore(secureStore);
const haptics = createNativeHaptics(() => prefsStore.getState().hapticsEnabled);
const network = createNativeNetwork();
const reminders = createNativeReminders();

const BOOT_FAILED_MESSAGE = "Cue could not open its storage. Some of your data may be missing.";

function useNativeSession(): AuthStore | null {
  const [authStore, setAuthStore] = useState<AuthStore | null>(null);

  useEffect(() => {
    let alive = true;
    void bootNativeStores({
      secure: secureStore,
      bulk: bulkStore,
      legacy: legacyStore,
      preferences: preferenceStorage,
      newInstallId: nativeCrypto.newId,
      digest: nativeCrypto.digest,
    })
      .then(
        () => null,
        () => BOOT_FAILED_MESSAGE,
      )
      .then((bootFailure) => {
        if (!alive) return;
        const store = createAuthStore({
          crypto: nativeCrypto,
          tokenStore,
          clientId: TRAKT_CLIENT_ID,
          redirectUri: NATIVE_REDIRECT_URI,
          redirect: () => {},
          redirectHandoff: { read: () => null, write: () => {}, clear: () => {} },
          native: true,
          traktBaseUrl: TRAKT_BASE_OVERRIDE,
        });
        if (bootFailure !== null) store.setState({ errorMessage: bootFailure });
        setAuthStore(store);
      });
    return () => {
      alive = false;
    };
  }, []);

  return authStore;
}

const runtimeDeps = {
  newId: nativeCrypto.newId,
  tokenStore,
  kv: bulkStore,
  redirectUri: NATIVE_REDIRECT_URI,
  clientId: TRAKT_CLIENT_ID,
  apiBaseUrl: TRAKT_BASE_OVERRIDE,
  browser: false,
  userAgent: `Cue/${nativeAppVersion}`,
  clearPersistedCaches,
  clearLocalPreferences: () => clearLocalPreferences(prefsStore),
};

function Gate(): ReactElement {
  const phase = useAuth((s) => s.phase);
  useSplashRelease(phase === "onboarding");

  if (phase === "connected") {
    return (
      <RuntimeBoot deps={runtimeDeps}>
        <RoutedApp />
      </RuntimeBoot>
    );
  }
  if (phase === "loading") return <Marker testID={TEST_IDS.authLoading} />;
  return <Onboarding />;
}

function RoutedApp(): ReactElement {
  useActivitiesPoll();
  useEpisodeReminders();
  useOpenTappedReminder();
  const responseTiming = useResponseTiming();

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(account)" options={{ presentation: "fullScreenModal" }} />
      </Stack>
      <SnackbarHost placement="root" />
      {responseTiming === null ? null : (
        <Marker accessibilityLabel={responseTiming} testID={TEST_IDS.responseTiming} />
      )}
      <AppIdle />
    </View>
  );
}

export default function RootLayout(): ReactElement {
  useScreenReader();
  const authStore = useNativeSession();
  const fontsSettled = useFontsSettled();
  const navigationTheme = useNavigationTheme();
  useAppearance(prefsStore);

  if (authStore === null || !fontsSettled) return <Marker testID={TEST_IDS.bootHold} />;

  return (
    <GestureHandlerRootView style={styles.root}>
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
                        <StatusBar style="auto" />
                        <ThemeProvider value={navigationTheme}>
                          <Gate />
                        </ThemeProvider>
                      </AuthStoreProvider>
                    </AppVersionProvider>
                  </RemindersProvider>
                </HapticsProvider>
              </NetworkProvider>
            </AppVisibilityProvider>
          </PrefsProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
