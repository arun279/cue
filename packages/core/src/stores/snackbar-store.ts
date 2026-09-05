import type { ReactNode } from "react";
import { create } from "zustand";
import { UNDO_WINDOW_MS } from "../sync-contract";

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

/**
 * The snackbar's Undo and the row's green check are the same take-back, so they
 * appear and retract together: one number, not two literals that can drift.
 */
export const DEFAULT_SNACK_TIMEOUT_MS = UNDO_WINDOW_MS;

/**
 * The app-level snackbar singleton's state: exactly one transient message, ever.
 * A new `show` REPLACES the current snack and resets its timer (never stacks);
 * any surface, React or not, talks to it through {@link showSnack}. The one
 * mounted `AppSnackbar` renders it.
 */
// Monotonic across dismissals: ownership checks (`seq === owned`) must never
// see a reused number after the slot cycles through null.
let nextSeq = 1;

export const useSnackbar = create<SnackbarState>((set) => ({
  snack: null,
  show: (input) => set({ snack: { ...input, seq: nextSeq++ } }),
  dismiss: () => set({ snack: null }),
}));

export function showSnack(input: SnackInput): void {
  useSnackbar.getState().show(input);
}

export function dismissSnack(): void {
  useSnackbar.getState().dismiss();
}
