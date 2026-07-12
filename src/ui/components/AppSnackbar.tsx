import { DEFAULT_SNACK_TIMEOUT_MS, type Snack, useSnackbar } from "@ui/components/snackbar-store";
import { type ReactElement, useEffect, useRef, useState } from "react";

/** Downward travel past which a release dismisses the snack. */
const SWIPE_DISMISS_PX = 48;
/** Travel before the drag claims the pointer, so action taps stay taps. */
const DRAG_START_PX = 8;
const EXIT_MS = 160;

/**
 * The one app-level snackbar (mounted once in the root layout): renders whatever
 * {@link useSnackbar} holds, auto-dismisses on its timer (paused under hover or
 * focus so a keyboard/pointer user is never raced off the recovery affordance),
 * and dismisses on a downward swipe. There is no close ✕: timeout + swipe
 * suffice, and every action is a full ≥44px target.
 */
export function AppSnackbar(): ReactElement | null {
  const snack = useSnackbar((s) => s.snack);
  const dismiss = useSnackbar((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState<Snack | null>(null);
  const drag = useRef<{ readonly startY: number; captured: boolean } | null>(null);
  const last = useRef<Snack | null>(null);

  useEffect(() => {
    if (snack === null || paused) return;
    const timer = setTimeout(dismiss, snack.timeoutMs ?? DEFAULT_SNACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [snack, paused, dismiss]);

  // Exit choreography: when the store empties, keep the last snack rendered in a
  // non-interactive "closing" phase for the fade-out, then unmount.
  useEffect(() => {
    if (snack !== null) {
      last.current = snack;
      setClosing(null);
      setDragY(0);
      return;
    }
    if (last.current === null) return;
    setClosing(last.current);
    last.current = null;
    const timer = setTimeout(() => setClosing(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [snack]);

  const shown = snack ?? closing;
  if (shown === null) return null;

  return (
    <div
      className="app-snackbar"
      role="status"
      aria-live="polite"
      data-testid="snackbar"
      data-state={snack === null ? "closing" : "open"}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onPointerDown={(e) => {
        drag.current = { startY: e.clientY, captured: false };
      }}
      onPointerMove={(e) => {
        const state = drag.current;
        if (state === null) return;
        const dy = e.clientY - state.startY;
        if (!state.captured && dy > DRAG_START_PX) {
          e.currentTarget.setPointerCapture(e.pointerId);
          state.captured = true;
        }
        if (state.captured) setDragY(Math.max(0, dy));
      }}
      onPointerUp={() => {
        const wasDismiss = dragY > SWIPE_DISMISS_PX;
        drag.current = null;
        setDragY(0);
        if (wasDismiss) dismiss();
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragY(0);
      }}
    >
      <span className="app-snackbar__message">{shown.message}</span>
      {(shown.actions ?? []).map((action) => (
        <button
          key={action.label}
          type="button"
          className="app-snackbar__action"
          {...(action.testId === undefined ? {} : { "data-testid": action.testId })}
          onClick={action.onPress}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
