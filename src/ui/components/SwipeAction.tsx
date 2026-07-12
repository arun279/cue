import { clampOffset, commitDirection, resolveIntent } from "@ui/components/swipe-math";
import { useHaptics } from "@ui/runtime/haptics";
import { Check, Pause } from "lucide-react";
import { type ReactElement, type ReactNode, useRef, useState } from "react";

interface SwipeActionProps {
  /** Commit a right swipe (green mark underlay). Omit to disable the direction. */
  onSwipeRight?(): void;
  /** Commit a left swipe (elevated stop underlay). Omit to disable the direction. */
  onSwipeLeft?(): void;
  readonly children: ReactNode;
}

interface GestureState {
  readonly startX: number;
  readonly startY: number;
  intent: "pending" | "horizontal" | "vertical";
  captured: boolean;
  pastThreshold: boolean;
}

/**
 * The swipe accelerator wrapping a queue/lapsed row: swipe right reveals the
 * green mark underlay, left the stop underlay; releasing past the 96px threshold
 * commits through the SAME handler the visible check uses, with a haptic tick at
 * the threshold cross. A 12px intent lock keeps vertical scrolling untouched,
 * and the gesture is touch/pen-only — never the only path (the check is the
 * accessible equivalent), so the wrapper itself carries no semantics.
 */
export function SwipeAction({
  onSwipeRight,
  onSwipeLeft,
  children,
}: SwipeActionProps): ReactElement {
  const haptics = useHaptics();
  const [offset, setOffset] = useState(0);
  const gesture = useRef<GestureState | null>(null);

  const canRight = onSwipeRight !== undefined;
  const canLeft = onSwipeLeft !== undefined;

  return (
    <div
      className="swipe"
      data-direction={offset > 0 ? "right" : offset < 0 ? "left" : "none"}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        gesture.current = {
          startX: e.clientX,
          startY: e.clientY,
          intent: "pending",
          captured: false,
          pastThreshold: false,
        };
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (g === null || g.intent === "vertical") return;
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (g.intent === "pending") g.intent = resolveIntent(dx, dy);
        if (g.intent !== "horizontal") return;
        if (!g.captured) {
          e.currentTarget.setPointerCapture(e.pointerId);
          g.captured = true;
        }
        const next = clampOffset(dx, canRight, canLeft);
        const past = commitDirection(next) !== null;
        if (past && !g.pastThreshold) haptics.swipeThreshold();
        g.pastThreshold = past;
        setOffset(next);
      }}
      onPointerUp={() => {
        if (gesture.current === null) return;
        const committed = commitDirection(offset);
        gesture.current = null;
        setOffset(0);
        if (committed === "right") onSwipeRight?.();
        if (committed === "left") onSwipeLeft?.();
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setOffset(0);
      }}
    >
      {canRight && (
        <span className="swipe__underlay swipe__underlay--mark" aria-hidden="true">
          <Check strokeWidth={2.5} />
        </span>
      )}
      {canLeft && (
        <span className="swipe__underlay swipe__underlay--stop" aria-hidden="true">
          <Pause strokeWidth={2.5} />
        </span>
      )}
      <div
        className="swipe__content"
        style={
          offset === 0 ? undefined : { transform: `translateX(${offset}px)`, transition: "none" }
        }
      >
        {children}
      </div>
    </div>
  );
}
