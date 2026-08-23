/**
 * What the Playwright suite cannot reach: a `pointercancel`, which it cannot
 * dispatch; a second finger, which its single-touch drag helper cannot add; the
 * haptic warm-up, which leaves no mark on the DOM; and the lifetime of the
 * non-passive `touchmove`, which is invisible from the page.
 */

import type { Haptics } from "@cue/core/domain/ports/haptics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PullToRefresh } from "@ui/components/PullToRefresh";
import { HapticsProvider } from "@ui/runtime/haptics";
import { type CueRuntime, RuntimeProvider } from "@ui/runtime/runtime";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

// jsdom ships PointerEvent but no pointer capture, and the region captures the
// pointer it claims.
Element.prototype.setPointerCapture = () => {};

const region = (): HTMLElement => {
  const node = document.querySelector<HTMLElement>("[data-testid='pull-to-refresh']");
  if (node === null) throw new Error("the pull region did not mount");
  return node;
};

/** One touch point, dispatched where React's own delegation picks it up. */
const pointer = (type: string, clientY: number, pointerId = 1): void => {
  act(() => {
    region().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: 100,
        clientY,
        pointerId,
        pointerType: "touch",
      }),
    );
  });
};

/** A released pull past the arm threshold: 300px of travel is 150px at half
 * rate, well past the 80px arm. */
const pullAndRelease = (): void => {
  pointer("pointerdown", 100);
  pointer("pointermove", 400);
  pointer("pointerup", 400);
};

function mountRegion(runtime: CueRuntime, haptics?: Haptics): void {
  const tree = (
    <QueryClientProvider client={new QueryClient()}>
      <RuntimeProvider value={runtime}>
        <PullToRefresh>
          <p>Up Next</p>
        </PullToRefresh>
      </RuntimeProvider>
    </QueryClientProvider>
  );
  mount(haptics === undefined ? tree : <HapticsProvider value={haptics}>{tree}</HapticsProvider>);
}

describe("a pull interrupted while its pass is still running", () => {
  it("stays refreshing on pointercancel, so a second pull cannot start a second pass", () => {
    // A pass that never resolves is the whole window this test is about.
    const flushWrites = vi.fn(() => new Promise<number>(() => {}));
    mountRegion({ flushWrites } as unknown as CueRuntime);

    pullAndRelease();
    expect(region().dataset["state"]).toBe("refreshing");

    pointer("pointercancel", 400);
    expect(region().dataset["state"]).toBe("refreshing");

    pullAndRelease();
    expect(flushWrites).toHaveBeenCalledTimes(1);
  });
});

describe("a second finger landing mid-pull", () => {
  it("leaves the pull to the finger that claimed it", () => {
    const flushWrites = vi.fn(() => Promise.resolve(0));
    mountRegion({ flushWrites } as unknown as CueRuntime);

    pointer("pointerdown", 100);
    pointer("pointermove", 400);
    expect(region().dataset["state"]).toBe("pulling");

    // A thumb resting on the list while the index finger drags: its own down
    // and up carry a different pointerId and mean nothing to this gesture.
    pointer("pointerdown", 200, 2);
    pointer("pointerup", 200, 2);
    expect(region().dataset["state"]).toBe("pulling");

    pointer("pointerup", 400);
    expect(region().dataset["state"]).toBe("refreshing");
    expect(flushWrites).toHaveBeenCalledTimes(1);
  });
});

describe("the non-passive touchmove", () => {
  it("is attached for the gesture and taken away with it", () => {
    // It is what makes every scroll inside the region wait on JS, and the region
    // wraps whole tab screens, so it may not outlive the gesture that needs it.
    mountRegion({ flushWrites: () => Promise.resolve(0) } as unknown as CueRuntime);
    const node = region();
    const added = vi.spyOn(node, "addEventListener");
    const removed = vi.spyOn(node, "removeEventListener");

    pointer("pointerdown", 100);
    expect(added.mock.calls.map(([type]) => type)).toEqual(["touchmove"]);
    expect(removed).not.toHaveBeenCalled();

    pointer("pointermove", 400);
    pointer("pointerup", 400);
    expect(removed.mock.calls.map(([type]) => type)).toEqual(["touchmove"]);
  });
});

describe("the pull's haptics", () => {
  it("warms the engine as the gesture locks vertical, before any tick is due", () => {
    const haptics = {
      success: vi.fn(),
      thresholdActivate: vi.fn(),
      thresholdDeactivate: vi.fn(),
      selection: vi.fn(),
      contextClick: vi.fn(),
      prepare: vi.fn(),
    };
    mountRegion({ flushWrites: () => Promise.resolve(0) } as unknown as CueRuntime, haptics);

    pointer("pointerdown", 100);
    // 40px of travel: past the 12px axis lock, nowhere near the 80px arm.
    pointer("pointermove", 140);

    expect(haptics.prepare).toHaveBeenCalledTimes(1);
    expect(haptics.thresholdActivate).not.toHaveBeenCalled();
  });
});
