import { create } from "zustand";
import type { StartFailure } from "../data/trakt/diagnostics";

/** The last time this process failed to build the runtime, kept for Diagnostics. */
export const useStartFailure = create<{ readonly failure: StartFailure | null }>(() => ({
  failure: null,
}));
