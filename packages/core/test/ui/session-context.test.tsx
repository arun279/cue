// @vitest-environment jsdom
import { type AuthState, AuthStoreProvider, useAuth } from "@cue/core/auth/store";
import { act, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
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
});
