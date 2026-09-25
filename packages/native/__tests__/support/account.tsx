import { createAuthStore } from "@cue/core/auth/create-auth-store";
import { AuthStoreProvider } from "@cue/core/auth/store";
import { AppVersionProvider } from "@cue/core/ports/app-version";
import { createPrefsStore, PrefsProvider } from "@cue/core/prefs/prefs-store";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useAppearance } from "../../src/screens/account/ThemeControl";
import { fakeRuntime, Harness, memoryPreferences, spyHaptics } from "./up-next";

export const STATS = {
  episodes: { watched: 81, minutes: 4698 },
  movies: { watched: 1, minutes: 105 },
  shows: { watched: 7 },
};

export function accountFixture(overrides: Partial<CueRuntime> = {}) {
  const storage = memoryPreferences();
  const prefs = createPrefsStore(storage);
  const disconnect = jest.fn<Promise<void>, []>(() => Promise.resolve());
  const auth = createAuthStore({
    crypto: {
      newId: () => "test",
      randomBytes: (size) => new Uint8Array(size),
      digest: async (bytes) => bytes,
    },
    tokenStore: { read: async () => null, write: async () => {}, clear: async () => {} },
    clientId: "test",
    redirectUri: "cue://auth/callback",
    redirect: () => {},
    redirectHandoff: { read: () => null, write: () => {}, clear: () => {} },
    native: true,
    traktBaseUrl: undefined,
  });
  auth.setState({ disconnect });
  const runtime = {
    ...fakeRuntime({}),
    loadStats: () => Promise.resolve(STATS),
    loadUserProfile: () =>
      Promise.resolve({
        displayName: "Jo Taylor",
        username: "jo",
        avatar: "https://example.com/avatar.png",
      }),
    ...overrides,
  };
  function AppearanceBridge(): null {
    useAppearance(prefs);
    return null;
  }
  return {
    prefs,
    storage,
    disconnect,
    runtime,
    paint: (children: ReactNode) =>
      render(
        <Harness runtime={runtime} haptics={spyHaptics()}>
          <PrefsProvider value={prefs}>
            <AuthStoreProvider value={auth}>
              <AppVersionProvider value="1.2.3 (45)">
                <AppearanceBridge />
                {children}
              </AppVersionProvider>
            </AuthStoreProvider>
          </PrefsProvider>
        </Harness>,
      ),
  };
}
