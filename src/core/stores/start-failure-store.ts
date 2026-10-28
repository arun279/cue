import { create } from "zustand";
import type { StartFailure } from "../data/trakt/diagnostics";

export const useStartFailure = create<{ readonly failure: StartFailure | null }>(() => ({
  failure: null,
}));
