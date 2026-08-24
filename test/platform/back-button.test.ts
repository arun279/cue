import { type BackHistory, bindHardwareBack } from "@platform/back-button";
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ current: "android" }));
const app = vi.hoisted(() => ({
  toggleBackButtonHandler: vi.fn(async (_options: { enabled: boolean }) => {}),
  addListener: vi.fn(async (_event: string, _onBack: () => void) => ({
    remove: async () => {},
  })),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform.current } }));
vi.mock("@capacitor/app", () => ({ App: app }));

/**
 * A router history that starts at a root tab. `back()` only asks the browser to
 * traverse: the depth moves, and subscribers hear about it, when `land()` runs
 * the popstate the browser would deliver on its own task.
 */
function fakeHistory(): BackHistory & { push(): void; land(): void } {
  let depth = 0;
  let popping = 0;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    depth: () => depth,
    back: () => {
      if (depth - popping > 0) popping += 1;
    },
    land: () => {
      depth -= popping;
      popping = 0;
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

/** Android delivers Back to the app only while the handler is enabled; with it
 * off the system plays its own predictive animation and finishes the activity. */
function androidBack(): { press(): void; exits(): number } {
  let exits = 0;
  return {
    press: () => {
      const [, onBack] = app.addListener.mock.lastCall ?? [];
      if (claims().at(-1) === true) onBack?.();
      else exits += 1;
    },
    exits: () => exits,
  };
}

/**
 * An enabled back handler is what suppresses Android's predictive back
 * animation and its back-to-home exit, so the app must only claim Back while it
 * has somewhere of its own to go.
 */
describe("the Android back seam", () => {
  beforeEach(() => {
    platform.current = "android";
    vi.clearAllMocks();
  });

  it("does not claim Back at a root tab, so the system keeps its own gesture", () => {
    bindHardwareBack(fakeHistory());
    expect(claims()).toEqual([false]);
  });

  it("claims Back as soon as there is history to pop, and lets go on the way out", () => {
    const history = fakeHistory();
    const os = androidBack();
    bindHardwareBack(history);
    history.push();
    history.push();
    os.press();
    history.land();
    os.press();
    history.land();
    expect(claims()).toEqual([false, true, true, true, true, false, false]);
    expect(os.exits()).toBe(0);
  });

  it("pops one entry per Back press", () => {
    const history = fakeHistory();
    const os = androidBack();
    bindHardwareBack(history);
    history.push();

    os.press();
    history.land();

    expect(history.depth()).toBe(0);
    expect(claims().at(-1)).toBe(false);
  });

  it("hands a second Back to the system while the last pop is still in flight", () => {
    // The router's depth moves only when the popstate lands, so a claim re-read
    // between the two presses is the entry the app has already left: the second
    // press would be spent popping nothing instead of closing the app.
    const history = fakeHistory();
    const os = androidBack();
    bindHardwareBack(history);
    history.push();

    os.press();
    os.press();
    history.land();

    expect(os.exits()).toBe(1);
    expect(history.depth()).toBe(0);
  });

  it("stops listening and stops toggling once unbound", () => {
    const history = fakeHistory();
    bindHardwareBack(history)();
    vi.clearAllMocks();
    history.push();
    expect(app.toggleBackButtonHandler).not.toHaveBeenCalled();
  });

  it("touches nothing on iOS, where the plugin implements no back handler", () => {
    // toggleBackButtonHandler is call.unimplemented() there, so every claim
    // would be a rejected promise nobody is waiting on.
    platform.current = "ios";
    const history = fakeHistory();

    bindHardwareBack(history);

    expect(app.toggleBackButtonHandler).not.toHaveBeenCalled();
    expect(app.addListener).not.toHaveBeenCalled();
  });
});
