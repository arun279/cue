/**
 * Mount-level smoke for the onboarding screen over a fake auth store: the two
 * connect paths stay wired to the store actions they always used, the Trakt
 * footnote link is present (required attribution), and the device-code beat
 * renders the code + polling state.
 */
import { type AuthActions, type AuthState, AuthStoreProvider } from "@cue/core/auth/store";
import { Onboarding } from "@ui/screens/onboarding/Onboarding";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Store = ReturnType<typeof makeStore>;

function makeStore(over: Partial<AuthState & AuthActions> = {}) {
  return createStore<AuthState & AuthActions>(() => ({
    phase: "onboarding",
    connectStatus: "idle",
    errorMessage: null,
    deviceCode: null,
    native: false,
    connectWithRedirect: vi.fn(async () => {}),
    connectWithDeviceCode: vi.fn(async () => {}),
    completeRedirect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    cancelConnect: vi.fn(),
    ...over,
  }));
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(store: Store): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <AuthStoreProvider value={store}>
        <Onboarding />
      </AuthStoreProvider>,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
});

const byTestId = (id: string): HTMLElement | null =>
  document.querySelector(`[data-testid='${id}']`);
const click = (el: Element | null): void => {
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("onboarding screen", () => {
  it("renders the welcome beat with the Trakt footnote link", () => {
    mount(makeStore());
    expect(byTestId("screen-onboarding")).not.toBeNull();
    expect(document.body.textContent).toContain("Your shows. One tap ahead.");
    expect(document.body.textContent).toContain("Powered by Trakt");
    const link = document.querySelector(".onb__foot a");
    expect(link?.getAttribute("href")).toBe("https://trakt.tv");
    expect(byTestId("button-connect")?.textContent).toBe("Connect Trakt");
  });

  it("connects via the PKCE redirect on web, then shows the hand-off state", () => {
    const store = makeStore();
    mount(store);
    click(byTestId("button-connect"));
    expect(store.getState().connectWithRedirect).toHaveBeenCalledTimes(1);
    act(() => store.setState({ connectStatus: "connecting" }));
    expect(byTestId("redirect-status")?.textContent).toContain("Continuing to Trakt…");
    expect(byTestId("button-connect")).toBeNull();
  });

  it("connects via the device-code grant on native, with no code-fallback link", () => {
    const store = makeStore({ native: true });
    mount(store);
    expect(byTestId("button-device-code")).toBeNull();
    click(byTestId("button-connect"));
    expect(store.getState().connectWithDeviceCode).toHaveBeenCalledTimes(1);
    expect(store.getState().connectWithRedirect).not.toHaveBeenCalled();
  });

  it("renders the device-code beat: code card, activate link, polling state", () => {
    const store = makeStore({
      deviceCode: { userCode: "1ABC2DEF", verificationUrl: "https://trakt.tv/activate" },
      connectStatus: "connecting",
    });
    mount(store);
    expect(byTestId("device-user-code")?.textContent).toBe("1ABC2DEF");
    expect(byTestId("button-copy-code")).not.toBeNull();
    expect(document.querySelector(".onb__lead a")?.getAttribute("href")).toBe(
      "https://trakt.tv/activate",
    );
    expect(byTestId("device-status")?.textContent).toContain("Waiting for you to approve");
    click(document.querySelector(".onb__alt"));
    expect(store.getState().cancelConnect).toHaveBeenCalledTimes(1);
  });

  it("surfaces a connect error on the welcome beat", () => {
    mount(makeStore({ connectStatus: "error", errorMessage: "Couldn't connect to Trakt." }));
    expect(byTestId("connect-error")?.textContent).toBe("Couldn't connect to Trakt.");
  });
});
