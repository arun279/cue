/**
 * The pull region's one concurrency rule, which the Playwright suite cannot
 * reach: a `pointercancel` is the browser interrupting a pointer we never see
 * released (a second finger, a system gesture taking over, the page scrolling
 * out from under it), and it must not settle a pass that is still running.
 * A settled region accepts the next pull, and the next pull starts a second
 * sync beside the first.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PullToRefresh } from "@ui/components/PullToRefresh";
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
const pointer = (type: string, clientY: number): void => {
  act(() => {
    region().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX: 100,
        clientY,
        pointerId: 1,
        pointerType: "touch",
      }),
    );
  });
};

/** A pull past the arm threshold, released: 300px of travel is 150px of pull at
 * half rate, well past the 80px arm. */
const pullAndRelease = (): void => {
  pointer("pointerdown", 100);
  pointer("pointermove", 400);
  pointer("pointerup", 400);
};

describe("a pull interrupted while its pass is still running", () => {
  it("stays refreshing on pointercancel, so a second pull cannot start a second pass", () => {
    // A pass that never resolves is the whole window this test is about.
    const flushWrites = vi.fn(() => new Promise<number>(() => {}));
    mount(
      <QueryClientProvider client={new QueryClient()}>
        <RuntimeProvider value={{ flushWrites } as unknown as CueRuntime}>
          <PullToRefresh>
            <p>Up Next</p>
          </PullToRefresh>
        </RuntimeProvider>
      </QueryClientProvider>,
    );

    pullAndRelease();
    expect(region().dataset["state"]).toBe("refreshing");

    pointer("pointercancel", 400);
    expect(region().dataset["state"]).toBe("refreshing");

    pullAndRelease();
    expect(flushWrites).toHaveBeenCalledTimes(1);
  });
});
