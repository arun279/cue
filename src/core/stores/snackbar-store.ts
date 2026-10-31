import { create } from "zustand";
import { UNDO_WINDOW_MS } from "../sync-contract";

interface SnackAction {
  readonly label: string;
  readonly testId?: string;
  onPress(): void;
}

interface SnackSentence {
  readonly subject: string;
  readonly predicate: string;
}

export type SnackMessage = string | SnackSentence;

export function snackText(message: SnackMessage): string {
  return typeof message === "string" ? message : `${message.subject}${message.predicate}`;
}

export interface SnackInput {
  readonly message: SnackMessage;
  readonly actions?: readonly SnackAction[];
  readonly timeoutMs?: number;
}

export interface Snack extends SnackInput {
  readonly seq: number;
}

interface SnackbarState {
  readonly snack: Snack | null;
  show(input: SnackInput): number;
  dismiss(): void;
}

export const DEFAULT_SNACK_TIMEOUT_MS = UNDO_WINDOW_MS;

let nextSeq = 1;
let shownAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function setSnackbarTimeout(timeout: number): void {
  clearTimeout(timer);
  timer = setTimeout(dismissSnack, Math.max(0, shownAt + timeout - Date.now()));
}

export const useSnackbar = create<SnackbarState>((set) => ({
  snack: null,
  show: (input) => {
    const seq = nextSeq++;
    shownAt = Date.now();
    set({ snack: { ...input, seq } });
    setSnackbarTimeout(input.timeoutMs ?? DEFAULT_SNACK_TIMEOUT_MS);
    return seq;
  },
  dismiss: () => {
    clearTimeout(timer);
    set({ snack: null });
  },
}));

export function showSnack(input: SnackInput): number {
  return useSnackbar.getState().show(input);
}

export function dismissSnack(): void {
  useSnackbar.getState().dismiss();
}

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
