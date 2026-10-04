import { create } from "zustand";
import type { ReadIncident } from "../data/trakt/diagnostics";

export const useReadIncidents = create<{ readonly incidents: readonly ReadIncident[] }>(() => ({
  incidents: [],
}));
