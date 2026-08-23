import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * Everything around the one thing a composition-root test is actually about.
 * `AppProviders` wires the auth store, the persisted query client, the router
 * and every platform seam, so a test that only wants to see what Settings
 * renders still has to answer all of them, and the answers are the same every
 * time. Only the platform and the client id differ, so only those are arguments.
 *
 * These are `doMock`, not `mock`: nothing is hoisted, so call this at the top of
 * the test file and reach the root through `await import("@app/providers")`
 * rather than a static import.
 */
export function mockCompositionRoot({
  native,
  clientId,
}: {
  native: boolean;
  clientId: string;
}): void {
  vi.doMock("@platform/platform", () => ({ isNativePlatform: () => native }));
  vi.doMock("@app/config", () => ({ TRAKT_CLIENT_ID: clientId, TRAKT_BASE_OVERRIDE: undefined }));
  vi.doMock("@app/AuthGate", async () => {
    const { Settings } = await import("@ui/screens/settings/Settings");
    return { AuthGate: () => <Settings /> };
  });
  vi.doMock("@app/auth/create-auth-store", () => ({ createAuthStore: () => ({}) }));
  vi.doMock("@app/persist", () => ({ requestPersistentStorage: vi.fn() }));
  vi.doMock("@app/query-client", () => ({
    PERSIST_BUSTER: "test",
    PERSIST_MAX_AGE: Number.POSITIVE_INFINITY,
    queryClient: {},
    queryPersister: {},
    shouldDehydrateQuery: () => false,
  }));
  vi.doMock("@tanstack/react-query-persist-client", () => ({
    PersistQueryClientProvider: ({ children }: { children: ReactNode }) => children,
  }));
  vi.doMock("@app/router", () => ({
    router: { history: { back: vi.fn(), canGoBack: () => false } },
  }));
  vi.doMock("@platform/back-button", () => ({ bindHardwareBack: () => () => {} }));
  vi.doMock("@platform/haptics", () => ({ createNativeHaptics: () => ({}) }));
  vi.doMock("@platform/kv", () => ({ createKeyValueStore: () => ({}) }));
  vi.doMock("@platform/reminders", () => ({ createNativeReminders: () => ({}) }));
  vi.doMock("@platform/status-bar", () => ({ applyStatusBarTheme: vi.fn() }));
  vi.doMock("@cue/core/ports/token-store", () => ({ createTokenStore: () => ({}) }));
  vi.doMock("@ui/app-shell/ScreenHeader", () => ({ ScreenHeader: () => null }));
  vi.doMock("@ui/screens/settings/SignOutRow", () => ({ SignOutRow: () => null }));
  vi.doMock("@ui/screens/settings/useSyncStatus", () => ({
    useSyncStatus: () => ({
      line: "Not synced yet",
      pending: 0,
      syncing: false,
      syncNow: vi.fn(() => Promise.resolve()),
    }),
  }));
}
