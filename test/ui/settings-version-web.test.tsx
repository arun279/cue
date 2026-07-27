import { AppProviders } from "@app/providers";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { version as packageVersion } from "../../package.json";
import { mountAsync } from "./_mount";

vi.mock("@capacitor/app", () => ({ App: { getInfo: vi.fn() } }));
vi.mock("@platform/platform", () => ({ isNativePlatform: () => false }));

vi.mock("@app/AuthGate", async () => {
  const { Settings } = await import("@ui/screens/settings/Settings");
  return { AuthGate: () => <Settings /> };
});
vi.mock("@app/auth/create-auth-store", () => ({ createAuthStore: () => ({}) }));
vi.mock("@app/config", () => ({ TRAKT_CLIENT_ID: "web-version-test" }));
vi.mock("@app/persist", () => ({ requestPersistentStorage: vi.fn() }));
vi.mock("@app/query-client", () => ({
  queryPersister: {},
  queryClient: {},
  PERSIST_MAX_AGE: Number.POSITIVE_INFINITY,
  PERSIST_BUSTER: "web-test",
}));
vi.mock("@tanstack/react-query-persist-client", () => ({
  PersistQueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@platform/status-bar", () => ({ applyStatusBarTheme: vi.fn() }));
vi.mock("@platform/token-store", () => ({ createTokenStore: vi.fn() }));
vi.mock("@app/router", () => ({
  router: { history: { back: vi.fn(), canGoBack: () => false } },
}));
vi.mock("@platform/back-button", () => ({ bindHardwareBack: vi.fn(() => vi.fn()) }));
vi.mock("@platform/haptics", () => ({ createNativeHaptics: vi.fn(() => ({})) }));
vi.mock("@platform/kv", () => ({ createKeyValueStore: vi.fn() }));

vi.mock("@ui/screens/settings/useSyncStatus", () => ({
  useSyncStatus: () => ({
    line: "Not synced",
    pending: 0,
    syncing: false,
    syncNow: vi.fn(),
  }),
}));
vi.mock("@ui/app-shell/ScreenHeader", () => ({ ScreenHeader: () => null }));
vi.mock("@ui/screens/settings/SignOutRow", () => ({ SignOutRow: () => null }));

describe("Settings web app version", () => {
  it("renders the package version", async () => {
    await mountAsync(<AppProviders />);
    const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
    expect(rendered?.textContent).toBe(packageVersion);
  });
});
