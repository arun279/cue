import { create } from "zustand";
import type { StartFailure } from "../domain/diagnostics";

export const useStartFailure = create<{ readonly failure: StartFailure | null }>(() => ({
  failure: null,
}));
