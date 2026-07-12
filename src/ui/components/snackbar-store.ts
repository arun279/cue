import type { ReactNode } from "react";
import { create } from "zustand";

interface SnackAction {
  readonly label: string;
  readonly testId?: string;
  onPress(): void;
}

export interface SnackInput {
  readonly message: ReactNode;
  readonly actions?: readonly SnackAction[];
  /** Auto-dismiss horizon; a replacing snack resets it. */
  readonly timeoutMs?: number;
}

export interface Snack extends SnackInput {
  /** Monotonic replace counter: a new snack keys a fresh timer + enter animation. */
  readonly seq: number;
}

interface SnackbarState {
  readonly snack: Snack | null;
  show(input: SnackInput): void;
  dismiss(): void;
}

export const DEFAULT_SNACK_TIMEOUT_MS = 5000;

/**
 * The app-level snackbar singleton's state: exactly one transient message, ever.
 * A new `show` REPLACES the current snack and resets its timer (never stacks);
 * any surface, React or not, talks to it through {@link showSnack}. The one
 * mounted `AppSnackbar` renders it.
 */
export const useSnackbar = create<SnackbarState>((set, get) => ({
  snack: null,
  show: (input) => set({ snack: { ...input, seq: (get().snack?.seq ?? 0) + 1 } }),
  dismiss: () => set({ snack: null }),
}));

export function showSnack(input: SnackInput): void {
  useSnackbar.getState().show(input);
}

export function dismissSnack(): void {
  useSnackbar.getState().dismiss();
}
