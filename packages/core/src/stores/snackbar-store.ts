import { create } from "zustand";
import { UNDO_WINDOW_MS } from "../sync-contract";

interface SnackAction {
  readonly label: string;
  readonly testId?: string;
  onPress(): void;
}

/**
 * A sentence whose subject is emphasized: the app names a show and then says
 * what happened to it. Which typeface carries the emphasis is each target's own
 * business, so the store holds the two halves rather than markup. It used to
 * hold a `<strong>` element, which is a DOM host component and crashes a native
 * text tree outright.
 */
interface SnackSentence {
  readonly subject: string;
  /** What happened to the subject, including the space in front of it. */
  readonly predicate: string;
}

export type SnackMessage = string | SnackSentence;

/** The message as one line, for an announcement or an assertion. */
export function snackText(message: SnackMessage): string {
  return typeof message === "string" ? message : `${message.subject}${message.predicate}`;
}

export interface SnackInput {
  readonly message: SnackMessage;
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

/**
 * A failure that speaks once and clears itself when acknowledged. Only failures
 * speak: a successful action is confirmed by what it did to the screen.
 */
export function showFailure(message: string, clear: () => void): void {
  showSnack({
    message,
    actions: [
      {
        label: "Dismiss",
        onPress: () => {
          clear();
          dismissSnack();
        },
      },
    ],
  });
}

/** An action that has landed and can still be taken back. */
export function showUndoable(message: SnackMessage, undo: () => void): void {
  showSnack({
    message,
    actions: [
      {
        label: "Undo",
        testId: "snackbar-undo",
        onPress: () => {
          dismissSnack();
          undo();
        },
      },
    ],
  });
}
