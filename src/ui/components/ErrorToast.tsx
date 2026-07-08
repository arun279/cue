import { Snackbar } from "@ui/screens/up-next/Snackbar";
import type { ReactElement } from "react";

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
