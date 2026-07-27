import { AppProviders } from "@app/providers";
import { act, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

const nativeApp = vi.hoisted(() => {
  const info = {
    version: "9.8-native",
    build: "native-build-765",
  };
  let settle: (value: typeof info) => void = () => {};
  let fail: (reason: unknown) => void = () => {};
  return {
    info,
    getInfo: vi.fn(
      () =>
        new Promise<typeof info>((resolve, reject) => {
          settle = resolve;
          fail = reject;
        }),
    ),
    resolve: () => settle(info),
    reject: (reason: unknown) => fail(reason),
  };
});

vi.mock("@capacitor/app", () => ({ App: { getInfo: nativeApp.getInfo } }));
vi.mock("@platform/platform", () => ({ isNativePlatform: () => true }));

vi.mock("@app/AuthGate", async () => {
  const { Settings } = await import("@ui/screens/settings/Settings");
  return { AuthGate: () => <Settings /> };
});
vi.mock("@app/auth/create-auth-store", () => ({ createAuthStore: () => ({}) }));
vi.mock("@app/config", () => ({ TRAKT_CLIENT_ID: "native-version-test" }));
vi.mock("@app/persist", () => ({ requestPersistentStorage: vi.fn() }));
vi.mock("@app/query-client", () => ({
  PERSIST_BUSTER: "test",
  PERSIST_MAX_AGE: Number.POSITIVE_INFINITY,
  queryClient: {},
  queryPersister: {},
  shouldDehydrateQuery: () => false,
}));
vi.mock("@tanstack/react-query-persist-client", () => ({
  PersistQueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@app/router", () => ({
  router: { history: { back: vi.fn(), canGoBack: () => false } },
}));
vi.mock("@platform/back-button", () => ({ bindHardwareBack: () => () => {} }));
vi.mock("@platform/haptics", () => ({ createNativeHaptics: () => ({}) }));
vi.mock("@platform/kv", () => ({ createKeyValueStore: () => ({}) }));
vi.mock("@platform/status-bar", () => ({ applyStatusBarTheme: vi.fn() }));
vi.mock("@platform/token-store", () => ({ createTokenStore: () => ({}) }));

vi.mock("@ui/app-shell/ScreenHeader", () => ({ ScreenHeader: () => null }));
vi.mock("@ui/screens/settings/SignOutRow", () => ({ SignOutRow: () => null }));
vi.mock("@ui/screens/settings/useSyncStatus", () => ({
  useSyncStatus: () => ({
    line: "Not synced yet",
    pending: 0,
    syncing: false,
    syncNow: vi.fn(() => Promise.resolve()),
  }),
}));

describe("Settings native app version", () => {
  beforeEach(() => {
    nativeApp.getInfo.mockClear();
  });

  it("replaces the empty seed with the native plugin identity", async () => {
    mount(<AppProviders />);
    const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
    expect(rendered?.textContent).toBe("");

    await act(async () => {
      nativeApp.resolve();
    });

    expect(rendered?.textContent).toBe(`${nativeApp.info.version} (${nativeApp.info.build})`);
  });

  it("shows an unknown version when the native plugin rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mount(<AppProviders />);
      const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
      expect(rendered?.textContent).toBe("");

      const rejection = new Error("native bridge failed");
      await act(async () => {
        nativeApp.reject(rejection);
      });

      expect(rendered?.textContent).toBe("Unknown");
      expect(error).toHaveBeenCalledWith("Failed to read native app version", rejection);
    } finally {
      error.mockRestore();
    }
  });
});
