import { Sheet } from "@ui/components/Sheet";
import type { ReactElement } from "react";

interface ConfirmPrimary {
  readonly label: string;
  /** Destructive confirms fill with the danger tint instead of amber. */
  readonly danger?: boolean;
  readonly testId: string;
  onPress(): void;
}

interface ConfirmSecondary {
  readonly label: string;
  readonly testId?: string;
  onPress(): void;
}

interface ConfirmSheetProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  readonly title: string;
  /** The consequence line: states the count/effect, never asks twice. */
  readonly body: string;
  readonly primary: ConfirmPrimary;
  readonly secondary?: ConfirmSecondary;
  readonly cancelLabel?: string;
}

/**
 * The one confirming overlay: title, consequence line, a filled primary and
 * plain secondary/cancel rows. Bulk marking is the only marking act that goes
 * through here — singles stay instant and snackbar-reversible.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  primary,
  secondary,
  cancelLabel = "Cancel",
}: ConfirmSheetProps): ReactElement {
  const run = (onPress: () => void) => () => {
    onPress();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <div className="confirm-sheet">
        <h2 className="confirm-sheet__title">{title}</h2>
        <p className="confirm-sheet__body">{body}</p>
        <button
          type="button"
          className={`sheet-btn ${primary.danger === true ? "sheet-btn--danger" : "sheet-btn--primary"}`}
          data-testid={primary.testId}
          onClick={run(primary.onPress)}
        >
          {primary.label}
        </button>
        {secondary !== undefined && (
          <button
            type="button"
            className="sheet-btn"
            {...(secondary.testId === undefined ? {} : { "data-testid": secondary.testId })}
            onClick={run(secondary.onPress)}
          >
            {secondary.label}
          </button>
        )}
        <button type="button" className="sheet-btn" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </button>
      </div>
    </Sheet>
  );
}
