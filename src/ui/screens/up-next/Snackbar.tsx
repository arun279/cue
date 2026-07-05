import { type ReactElement, useEffect, useState } from "react";

interface SnackbarProps {
  readonly message: string;
  readonly actionLabel: string;
  readonly testId: string;
  onAction(): void;
  onDismiss(): void;
  /** Auto-dismiss after this many ms; omit to persist until acted on. */
  readonly autoDismissMs?: number;
}

/**
 * A single transient action toast (Undo / error recovery). Announced politely so
 * a screen reader hears the change without stealing focus, and always offering
 * both the action and an explicit dismiss (Nielsen: user control). The
 * auto-dismiss timer pauses while the toast is hovered or holds focus so a
 * keyboard or pointer user is never raced off the only recovery affordance
 * (WCAG 2.2.1 Timing Adjustable).
 */
export function Snackbar({
  message,
  actionLabel,
  testId,
  onAction,
  onDismiss,
  autoDismissMs,
}: SnackbarProps): ReactElement {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (autoDismissMs === undefined || paused) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss, paused]);

  return (
    <div
      className="snackbar"
      role="status"
      aria-live="polite"
      data-testid={testId}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <span className="snackbar__message">{message}</span>
      <button
        type="button"
        className="snackbar__action"
        data-testid={`${testId}-action`}
        onClick={onAction}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        className="snackbar__dismiss"
        aria-label="Dismiss"
        data-testid={`${testId}-dismiss`}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
