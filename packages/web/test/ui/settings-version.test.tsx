import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockCompositionRoot } from "../support/composition-root-mocks";
import { mount } from "./_mount";

const info = { version: "9.8-native", build: "native-build-765" };
let settle: (value: typeof info) => void = () => {};
let fail: (reason: unknown) => void = () => {};
const getInfo = vi.fn(
  () =>
    new Promise<typeof info>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    }),
);

vi.doMock("@capacitor/app", () => ({ App: { getInfo } }));
mockCompositionRoot({ native: true, clientId: "native-version-test" });

describe("Settings native app version", () => {
  beforeEach(() => {
    getInfo.mockClear();
  });

  it("replaces the empty seed with the native plugin identity", async () => {
    const { AppProviders } = await import("@app/providers");
    mount(<AppProviders />);
    const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
    expect(rendered?.textContent).toBe("");

    await act(async () => {
      settle(info);
    });

    expect(rendered?.textContent).toBe(`${info.version} (${info.build})`);
  });

  it("shows an unknown version when the native plugin rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { AppProviders } = await import("@app/providers");
      mount(<AppProviders />);
      const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
      expect(rendered?.textContent).toBe("");

      const rejection = new Error("native bridge failed");
      await act(async () => {
        fail(rejection);
      });

      expect(rendered?.textContent).toBe("Unknown");
      expect(error).toHaveBeenCalledWith("Failed to read native app version", rejection);
    } finally {
      error.mockRestore();
    }
  });
});
