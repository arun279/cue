/**
 * The `AppVisibility` adapter, against the real Page Visibility API. What it
 * uniquely owns: that a tab in the background reads as hidden, and that the
 * event the browser fires is the one this port listens to, which is what stops
 * the freshness poll spending Trakt budget while nobody is looking.
 */

import { webAppVisibility } from "@platform/app-visibility";
import { afterEach, describe, expect, it, vi } from "vitest";

/** jsdom's `visibilityState` is a getter on the document, so it is stubbed. */
function setVisibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webAppVisibility", () => {
  it("reads a foreground tab as visible", () => {
    setVisibility("visible");
    expect(webAppVisibility.isVisible()).toBe(true);
  });

  it("reads a tab in the background as hidden", () => {
    setVisibility("hidden");
    expect(webAppVisibility.isVisible()).toBe(false);
  });

  it("announces the tab changing state", () => {
    const listener = vi.fn();
    const unsubscribe = webAppVisibility.subscribe(listener);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("goes quiet once unsubscribed", () => {
    const listener = vi.fn();
    webAppVisibility.subscribe(listener)();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).not.toHaveBeenCalled();
  });
});
