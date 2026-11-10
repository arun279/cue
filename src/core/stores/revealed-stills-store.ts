import { create } from "zustand";

export const useRevealedStills = create<{ readonly episodeIds: ReadonlySet<number> }>(() => ({
  episodeIds: new Set(),
}));
