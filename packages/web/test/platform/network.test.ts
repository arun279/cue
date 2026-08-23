/**
 * The `Network` adapter, against the real browser events rather than a stub.
 * What it uniquely owns: that the two window events the browser actually fires
 * are the two this port listens to. Nothing above it can catch a missing
 * `offline` registration, because every layer above injects a port.
 */

import { webNetwork } from "@platform/network";
import { afterEach, describe, expect, it, vi } from "vitest";

/** jsdom's `navigator.onLine` is a getter, so it is stubbed rather than assigned. */
function setOnline(value: boolean): void {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webNetwork", () => {
  it("reports what the browser believes about the connection", () => {
    setOnline(true);
    expect(webNetwork.isOnline()).toBe(true);
    setOnline(false);
    expect(webNetwork.isOnline()).toBe(false);
  });

  it("announces a reconnection", () => {
    const listener = vi.fn();
    const unsubscribe = webNetwork.subscribe(listener);
    window.dispatchEvent(new Event("online"));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("announces a disconnection too, so a listener can stop retrying", () => {
    const listener = vi.fn();
    const unsubscribe = webNetwork.subscribe(listener);
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("goes quiet once unsubscribed, on both events", () => {
    const listener = vi.fn();
    webNetwork.subscribe(listener)();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("offline"));
    expect(listener).not.toHaveBeenCalled();
  });
});
