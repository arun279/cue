import { Snackbar } from "@ui/components/Snackbar";
import type { ReactElement } from "react";

interface ErrorRetryProps {
  readonly title: string;
  readonly testId: string;
  readonly buttonTestId: string;
  onRetry(): void;
}

/**
 * The hard load-failure block: a title, the shared "try again" hint, and a Retry
 * button. Distinct from genuine empty states ("Nothing tracked yet", "You're all
 * caught up"), which share the `.empty` shell but mean success, not failure.
 */
export function ErrorRetry({
  title,
  testId,
  buttonTestId,
  onRetry,
}: ErrorRetryProps): ReactElement {
  return (
    <div className="empty" data-testid={testId}>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">Check your connection and try again.</p>
      <button type="button" className="button" data-testid={buttonTestId} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

interface ErrorToastProps {
  readonly testId: string;
  readonly message: string;
  onDismiss(): void;
}

/**
 * The dismiss-only error snackbar: one control that both acts and dismisses, so the
 * label is always "Dismiss" and the single callback clears the error. Distinct from
 * Undo/notice toasts, which carry a real second action.
 */
export function ErrorToast({ testId, message, onDismiss }: ErrorToastProps): ReactElement {
  return (
    <Snackbar
      testId={testId}
      message={message}
      actionLabel="Dismiss"
      onAction={onDismiss}
      onDismiss={onDismiss}
    />
  );
}
