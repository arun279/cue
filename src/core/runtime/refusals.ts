import type { QueuedOp } from "../domain/write-queue/types";
import { dismissSnack, showSnack, useSnackbar } from "../stores/snackbar-store";

export const REFUSED_MESSAGE = "Couldn't save a change to Trakt.";

interface RefusedLog {
  refusals(): readonly QueuedOp[];
  forget(id: string): void;
}

/**
 * Says that Trakt refused a write, once while the message is on screen however many parts of an
 * action it refused, and hands each refused write to `readBack` until its read-back has landed.
 */
export function createRefusals(log: RefusedLog) {
  let readBack: ((op: QueuedOp) => Promise<void>) | null = null;
  let said: number | null = null;
  const correcting = new Set<string>();
  const correct = (op: QueuedOp): void => {
    if (readBack === null || correcting.has(op.id)) return;
    correcting.add(op.id);
    void readBack(op)
      .then(
        () => log.forget(op.id),
        () => undefined,
      )
      .finally(() => correcting.delete(op.id));
  };
  const retry = (): void => {
    for (const op of log.refusals()) correct(op);
  };
  return {
    refused(op: QueuedOp): void {
      if (said === null || useSnackbar.getState().snack?.seq !== said) {
        said = showSnack({
          message: REFUSED_MESSAGE,
          actions: [{ label: "Dismiss", onPress: dismissSnack }],
        });
      }
      correct(op);
    },
    retry,
    onRefused(handler: (op: QueuedOp) => Promise<void>): () => void {
      readBack = handler;
      retry();
      return () => {
        if (readBack === handler) readBack = null;
      };
    },
  };
}
