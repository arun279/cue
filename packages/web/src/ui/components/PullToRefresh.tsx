import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { useHaptics } from "@cue/core/runtime/haptics";
import { resolveIntent } from "@ui/components/gesture-intent";
import {
  isArmed,
  PULL_THRESHOLD_PX,
  pullDistance,
  pullProgress,
  settleDelayMs,
} from "@ui/components/pull-math";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

type Phase = "idle" | "pulling" | "refreshing";

interface Gesture {
  /** The one touch the region answers to: a second finger's events carry
   * another id and belong to no gesture here. */
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  intent: "pending" | "vertical" | "abandoned";
  armed: boolean;
}

function pulledStyle(distance: number, phase: Phase): CSSProperties | undefined {
  // No transform at rest: a permanent one would make this a containing block for
  // every sticky day header underneath it.
  if (distance === 0) return undefined;
  return {
    transform: `translateY(${distance}px)`,
    ...(phase === "pulling" ? { transition: "none" } : {}),
  };
}

/**
 * Pull to refresh for a window-scrolled tab screen, in the DOM for the reason
 * pull-math states. Releasing past the threshold runs the SAME manual pass as
 * Settings ▸ Sync now, which stays as the tap-only equivalent the gesture is
 * required to have. Touch and pen only, like the swipe rows, and resolved
 * against the shared axis lock so a row swipe and a pull can never both claim
 * one drag.
 *
 * A screen wraps everything below its sticky header in this, chrome included: a
 * drag that starts on a filter rail or a search field is the same gesture as one
 * that starts on the list, and a band that ignores it is a dead zone the user
 * finds by accident. The exceptions are the two things that do not move with the
 * content: the sticky ScreenHeader, and the SyncStrip the indicator parks above.
 */
export function PullToRefresh({ children }: { readonly children: ReactNode }): ReactElement {
  const haptics = useHaptics();
  const { run } = useSyncNow();
  const [phase, setPhase] = useState<Phase>("idle");
  const [distance, setDistance] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const gesture = useRef<Gesture | null>(null);

  // React registers touchmove passively at the root, so the only way to stop the
  // web view scrolling (or rubber-banding) under a claimed pull is our own
  // non-passive listener. It lives exactly as long as the gesture that may need
  // it: the region wraps a whole tab screen, and a standing non-passive
  // touchmove makes every scroll inside it wait on JS. touch-action stays at its
  // default: the pull shares the scroller's own axis, and pinning it would take
  // the horizontal chip rails and swipe rows down with it.
  const claimScroll = useCallback((event: TouchEvent): void => {
    if (gesture.current?.intent === "vertical") event.preventDefault();
  }, []);

  /** End the owning pointer's gesture; `null` for anybody else's event. */
  const release = (event: PointerEvent<HTMLDivElement>): Gesture | null => {
    const g = gesture.current;
    if (g === null || g.pointerId !== event.pointerId) return null;
    gesture.current = null;
    event.currentTarget.removeEventListener("touchmove", claimScroll);
    return g;
  };

  const settle = (): void => {
    setPhase("idle");
    setDistance(0);
  };

  const refresh = async (): Promise<void> => {
    setPhase("refreshing");
    setDistance(PULL_THRESHOLD_PX);
    setAnnouncement("Refreshing");
    const startedAt = Date.now();
    const clean = await run();
    await new Promise((resolve) => setTimeout(resolve, settleDelayMs(Date.now() - startedAt)));
    // A failed pass already speaks through the snackbar's live region; saying it
    // twice to a screen reader is worse than saying it once.
    setAnnouncement(clean ? "Up to date" : "");
    settle();
  };

  const progress = pullProgress(distance);

  return (
    <div
      className="pull"
      data-state={phase}
      data-testid="pull-to-refresh"
      onPointerDown={(event) => {
        // Only from the very top of the scroller, decided at pointerdown: past
        // that the drag belongs to the scroll, and touch-action cannot be
        // renegotiated once a gesture has started. A finger arriving while
        // another already owns the region is not a second pull.
        if (
          gesture.current !== null ||
          event.pointerType === "mouse" ||
          phase === "refreshing" ||
          globalThis.scrollY > 0
        ) {
          return;
        }
        gesture.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          intent: "pending",
          armed: false,
        };
        event.currentTarget.addEventListener("touchmove", claimScroll, { passive: false });
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (g === null || g.pointerId !== event.pointerId || g.intent === "abandoned") return;
        const dy = event.clientY - g.startY;
        if (g.intent === "pending") {
          const intent = resolveIntent(event.clientX - g.startX, dy);
          if (intent === "pending") return;
          if (intent === "horizontal" || dy <= 0) {
            g.intent = "abandoned";
            return;
          }
          g.intent = "vertical";
          event.currentTarget.setPointerCapture(event.pointerId);
          // The head start SwipeAction takes at its own intent lock, and the
          // pull needs it more: it is the slowest gesture in the app, so a
          // generator fired cold at the threshold arrives late enough to read
          // as unrelated to the drag.
          haptics.prepare();
          setPhase("pulling");
        }
        const next = pullDistance(dy);
        const armed = isArmed(next);
        if (armed !== g.armed) {
          if (armed) haptics.thresholdActivate();
          else haptics.thresholdDeactivate();
          g.armed = armed;
        }
        setDistance(next);
      }}
      onPointerUp={(event) => {
        const g = release(event);
        if (g === null || g.intent !== "vertical") return;
        if (g.armed) void refresh();
        else settle();
      }}
      onPointerCancel={(event) => {
        // Only the gesture that owns the region may settle it: a system gesture
        // taking over drops the pull, while a cancel for any other pointer would
        // drop a pass still in flight back to idle, and the next pull would run
        // a second one beside it.
        const g = release(event);
        if (g?.intent === "vertical") settle();
      }}
    >
      <span
        className="pull__indicator"
        aria-hidden="true"
        style={{ ...pulledStyle(distance, phase), opacity: phase === "refreshing" ? 1 : progress }}
      >
        <svg className="pull__ring" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle className="pull__track" cx="12" cy="12" r="9" />
          <circle
            className="pull__sweep"
            cx="12"
            cy="12"
            r="9"
            pathLength={1}
            {...(phase === "refreshing" ? {} : { strokeDasharray: `${progress} 1` })}
          />
          <circle className="pull__dot" cx="12" cy="3" r="2.4" />
        </svg>
      </span>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <div className="pull__content" style={pulledStyle(distance, phase)}>
        {children}
      </div>
    </div>
  );
}
