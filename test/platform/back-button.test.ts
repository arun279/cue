import { type BackHistory, bindHardwareBack } from "@platform/back-button";
import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  toggleBackButtonHandler: vi.fn(async (_options: { enabled: boolean }) => {}),
  addListener: vi.fn(async (_event: string, _onBack: () => void) => ({
    remove: async () => {},
  })),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "android" } }));
vi.mock("@capacitor/app", () => ({ App: app }));

/** A history that starts at a root tab and can be pushed and popped. */
function fakeHistory(): BackHistory & { push(): void } {
  let depth = 0;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    canGoBack: () => depth > 0,
    back: () => {
      depth -= 1;
      notify();
    },
    push: () => {
      depth += 1;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const claims = (): boolean[] =>
  app.toggleBackButtonHandler.mock.calls.map(([options]) => options.enabled);

/**
 * An enabled back handler is what suppresses Android's predictive back
 * animation and its back-to-home exit, so the app must only claim Back while it
 * has somewhere of its own to go.
 */
describe("the Android back seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not claim Back at a root tab, so the system keeps its own gesture", () => {
    bindHardwareBack(fakeHistory());
    expect(claims()).toEqual([false]);
  });

  it("claims Back as soon as there is history to pop, and lets go on the way out", () => {
    const history = fakeHistory();
    bindHardwareBack(history);
    history.push();
    history.push();
    history.back();
    history.back();
    expect(claims()).toEqual([false, true, true, true, false]);
  });

  it("pops one entry per Back press and re-reads the claim afterwards", () => {
    const history = fakeHistory();
    bindHardwareBack(history);
    const [, press] = app.addListener.mock.lastCall ?? [];
    history.push();
    app.toggleBackButtonHandler.mockClear();

    press?.();

    expect(history.canGoBack()).toBe(false);
    expect(claims()).toEqual([false, false]);
  });

  it("stops listening and stops toggling once unbound", () => {
    const history = fakeHistory();
    bindHardwareBack(history)();
    vi.clearAllMocks();
    history.push();
    expect(app.toggleBackButtonHandler).not.toHaveBeenCalled();
  });
});
