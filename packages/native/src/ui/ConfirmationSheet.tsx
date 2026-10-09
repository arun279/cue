import type { Confirmation } from "./useConfirmation";

export interface ConfirmationSheetProps {
  readonly confirmation: Confirmation | null;
  readonly onDismiss: () => void;
}

export function ConfirmationSheet(_props: ConfirmationSheetProps): null {
  return null;
}
