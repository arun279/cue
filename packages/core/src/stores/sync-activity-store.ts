import { create } from "zustand";
import type { SubmitOutcome } from "../runtime/runtime";

interface SyncActivityState {
  readonly pending: number;
  readonly checked: boolean;
  readonly startedWrites: number;
  readonly completedWrites: number;
  readonly lastWrite: { readonly id: number; readonly outcome: SubmitOutcome } | null;
  begin(): void;
  end(): void;
  setChecked(checked: boolean): void;
}

export const useSyncActivity = create<SyncActivityState>((set) => ({
  pending: 0,
  checked: false,
  startedWrites: 0,
  completedWrites: 0,
  lastWrite: null,
  begin: () => set((state) => ({ pending: state.pending + 1 })),
  end: () => set((state) => ({ pending: Math.max(0, state.pending - 1) })),
  setChecked: (checked) => set({ checked }),
}));

export async function trackWrite<T>(run: () => Promise<T>): Promise<T> {
  const { begin, end } = useSyncActivity.getState();
  begin();
  try {
    return await run();
  } finally {
    end();
  }
}
