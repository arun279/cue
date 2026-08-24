/**
 * What the Playwright swipe suite cannot reach: its CDP drag carries one touch
 * point, and a swipe commits a write, so a gesture that reads a second finger's
 * events as its own marks an episode the user never released.
 */
import { SwipeAction } from "@ui/components/SwipeAction";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

// jsdom ships PointerEvent but no pointer capture, and the row captures the
// pointer it claims.
Element.prototype.setPointerCapture = () => {};

const row = (): HTMLElement => {
  const node = document.querySelector<HTMLElement>(".swipe");
  if (node === null) throw new Error("the swipe row did not mount");
  return node;
};

const pointer = (type: string, clientX: number, pointerId = 1): void => {
  act(() => {
    row().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        clientX,
        clientY: 50,
        pointerId,
        pointerType: "touch",
      }),
    );
  });
};

describe("a second finger on a half-swiped row", () => {
  it("cannot release the swipe the first one is still holding", () => {
    const onSwipeRight = vi.fn();
    mount(
      <SwipeAction onSwipeRight={onSwipeRight}>
        <p>Solo S1 E2</p>
      </SwipeAction>,
    );

    // The index finger drags past the 96px commit threshold and holds there.
    pointer("pointerdown", 100);
    pointer("pointermove", 240);
    expect(row().dataset["direction"]).toBe("right");

    // A thumb taps the row: its own down and up belong to no gesture here.
    pointer("pointerdown", 300, 2);
    pointer("pointerup", 300, 2);
    expect(onSwipeRight).not.toHaveBeenCalled();

    // Only the finger that claimed the row commits it.
    pointer("pointerup", 240);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });
});
