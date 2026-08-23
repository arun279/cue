import { type RefCallback, useCallback, useLayoutEffect, useRef } from "react";

interface Point {
  readonly left: number;
  readonly top: number;
}

export interface FlipGroup {
  /** Stable ref callback registering a keyed element into the group. */
  ref(key: string | number): RefCallback<HTMLElement>;
}

const FLIP_MS = 240;
const EASE_STANDARD = "cubic-bezier(0.2, 0, 0, 1)";

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * FLIP for a keyed list: positions are measured at every committed layout
 * (i.e. BEFORE the next optimistic cache patch re-renders), and after a render
 * that moved an element, it plays a transform-only 240ms slide from its old slot
 * to its new one. Offset-parent coordinates, not viewport rects, so scrolling
 * never fakes a move. Reduced motion repositions instantly.
 */
export function useFlip(): FlipGroup {
  const elements = useRef(new Map<string | number, HTMLElement>());
  const positions = useRef(new Map<string | number, Point>());
  const callbacks = useRef(new Map<string | number, RefCallback<HTMLElement>>());

  useLayoutEffect(() => {
    const previous = positions.current;
    const next = new Map<string | number, Point>();
    const reduced = prefersReducedMotion();
    for (const [key, el] of elements.current) {
      if (!el.isConnected) continue;
      const point: Point = { left: el.offsetLeft, top: el.offsetTop };
      next.set(key, point);
      const before = previous.get(key);
      if (reduced || before === undefined) continue;
      const dx = before.left - point.left;
      const dy = before.top - point.top;
      if (dx === 0 && dy === 0) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: FLIP_MS,
        easing: EASE_STANDARD,
      });
    }
    positions.current = next;
  });

  const ref = useCallback((key: string | number): RefCallback<HTMLElement> => {
    const cached = callbacks.current.get(key);
    if (cached !== undefined) return cached;
    const callback: RefCallback<HTMLElement> = (el) => {
      if (el === null) elements.current.delete(key);
      else elements.current.set(key, el);
    };
    callbacks.current.set(key, callback);
    return callback;
  }, []);

  return { ref };
}
