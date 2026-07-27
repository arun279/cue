import { getNativeAppVersion } from "@platform/app-version";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeApp = vi.hoisted(() => ({
  getInfo: vi.fn(() =>
    Promise.resolve({
      version: "9.8-native",
      build: "native-build-765",
    }),
  ),
}));

vi.mock("@capacitor/app", () => ({ App: { getInfo: nativeApp.getInfo } }));
vi.mock("@platform/platform", () => ({ isNativePlatform: () => false }));

describe("native app version web guard", () => {
  beforeEach(() => {
    nativeApp.getInfo.mockClear();
  });

  it("skips the native plugin on web", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(getNativeAppVersion()).resolves.toBeNull();
      expect(nativeApp.getInfo).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
