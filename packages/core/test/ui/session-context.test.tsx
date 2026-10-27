// @vitest-environment jsdom
import { type AuthState, AuthStoreProvider, useAuth } from "@cue/core/auth/store";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand";

const signedOut: AuthState = {
  phase: "onboarding",
  connectStatus: "idle",
  errorMessage: null,
  deviceCode: null,
};

describe("the session's context hooks", () => {
  it("follow the auth store the composition root provides", () => {
    const noop = async () => {};
    const store = createStore(() => ({
      ...signedOut,
      connectWithDeviceCode: noop,
      disconnect: noop,
      endSession: noop,
      cancelConnect: () => {},
    }));
    const { result } = renderHook(() => useAuth((state) => state.phase), {
      wrapper: ({ children }) => <AuthStoreProvider value={store}>{children}</AuthStoreProvider>,
    });
    expect(result.current).toBe("onboarding");
    act(() => store.setState({ phase: "connected" }));
    expect(result.current).toBe("connected");
  });
});
