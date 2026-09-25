// @vitest-environment jsdom
import { type AuthState, AuthStoreProvider, useAuth } from "@cue/core/auth/store";
import { AppVersionProvider, useAppVersion } from "@cue/core/ports/app-version";
import { useRuntime } from "@cue/core/runtime/runtime";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand";
import { mount } from "./_mount";

function read<T>(useValue: () => T, wrap: (node: ReactNode) => ReactNode = (node) => node) {
  const seen: T[] = [];
  function Probe(): null {
    seen.push(useValue());
    return null;
  }
  mount(wrap(<Probe />));
  return () => seen.at(-1);
}

const signedOut: AuthState = {
  phase: "onboarding",
  connectStatus: "idle",
  errorMessage: null,
  deviceCode: null,
  native: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the session's context hooks", () => {
  it("follow the auth store the composition root provides", () => {
    const noop = async () => {};
    const store = createStore(() => ({
      ...signedOut,
      connectWithRedirect: noop,
      connectWithDeviceCode: noop,
      completeRedirect: noop,
      disconnect: noop,
      endSession: noop,
      cancelConnect: () => {},
    }));
    const phase = read(
      () => useAuth((state) => state.phase),
      (node) => <AuthStoreProvider value={store}>{node}</AuthStoreProvider>,
    );
    expect(phase()).toBe("onboarding");
    act(() => store.setState({ phase: "connected" }));
    expect(phase()).toBe("connected");
  });

  it("name the missing provider when mounted outside a session", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => read(() => useAuth((state) => state.phase))).toThrow(
      "useAuth must be used within an AuthStoreProvider.",
    );
    expect(() => read(useRuntime)).toThrow("useRuntime must be used within a RuntimeProvider.");
  });

  it("show no app version until the composition root supplies one", () => {
    expect(read(useAppVersion)()).toBe("");
  });

  it("show the app version the composition root supplies", () => {
    const version = read(useAppVersion, (node) => (
      <AppVersionProvider value="1.4.0">{node}</AppVersionProvider>
    ));
    expect(version()).toBe("1.4.0");
  });
});
