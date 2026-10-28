import { create } from "zustand";
import type { ReadIncident } from "../domain/diagnostics";

export const useReadIncidents = create<{ readonly incidents: readonly ReadIncident[] }>(() => ({
  incidents: [],
}));
