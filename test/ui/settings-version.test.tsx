import { Settings } from "@ui/screens/settings/Settings";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { version as packageVersion } from "../../package.json";
import { mount } from "./_mount";

const nativeApp = vi.hoisted(() => {
  const info = {
    name: "Cue Native Gate",
    id: "com.cue.native-gate",
    version: "9.8-native",
    build: "native-build-765",
  };
  let settle = (_value: typeof info): void => {
    throw new Error("Native app-info promise was not initialized");
  };
  const pending = new Promise<typeof info>((resolve) => {
    settle = resolve;
  });
  return {
    info,
    getInfo: vi.fn(() => pending),
    resolve: () => settle(info),
  };
});

vi.mock("@capacitor/app", () => ({ App: { getInfo: nativeApp.getInfo } }));
vi.mock("@platform/platform", () => ({ isNativePlatform: () => true }));

vi.mock("@app/AuthGate", () => ({ AuthGate: () => null }));
vi.mock("@app/auth/create-auth-store", () => ({ createAuthStore: () => ({}) }));
vi.mock("@app/config", () => ({ TRAKT_CLIENT_ID: "native-version-test" }));
vi.mock("@app/persist", () => ({ requestPersistentStorage: vi.fn() }));
vi.mock("@app/query-client", () => ({
  PERSIST_BUSTER: "test",
  PERSIST_MAX_AGE: Number.POSITIVE_INFINITY,
  queryClient: {},
  queryPersister: {},
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

await import("@app/providers");

describe("Settings native app version", () => {
  it("replaces the package fallback with the native plugin identity", async () => {
    mount(<Settings />);
    const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
    expect(rendered?.textContent).toBe(packageVersion);

    await act(async () => {
      nativeApp.resolve();
    });

    expect(nativeApp.getInfo).toHaveBeenCalledTimes(1);
    expect(
      rendered?.textContent,
      "native Settings must not render the package.json version",
    ).not.toBe(packageVersion);
    expect(rendered?.textContent).toBe(`${nativeApp.info.version} (${nativeApp.info.build})`);
  });
});
