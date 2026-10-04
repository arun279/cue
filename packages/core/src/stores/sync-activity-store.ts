import { create } from "zustand";

interface SyncActivityState {
  readonly pending: number;
  begin(): void;
  end(): void;
}

export const useSyncActivity = create<SyncActivityState>((set) => ({
  pending: 0,
  begin: () => set((state) => ({ pending: state.pending + 1 })),
  end: () => set((state) => ({ pending: Math.max(0, state.pending - 1) })),
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
