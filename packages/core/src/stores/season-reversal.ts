import { create } from "zustand";

interface SeasonReversalState {
  readonly deltas: ReadonlyMap<string, ReadonlySet<number>>;
  remember(showId: number, season: number, episodes: readonly number[]): void;
  forget(showId: number, season: number): void;
}

function keyOf(showId: number, season: number): string {
  return `${showId}:${season}`;
}

const useSeasonReversalStore = create<SeasonReversalState>((set) => ({
  deltas: new Map(),
  remember: (showId, season, episodes) =>
    set((state) => {
      const next = new Map(state.deltas);
      next.set(keyOf(showId, season), new Set(episodes));
      return { deltas: next };
    }),
  forget: (showId, season) =>
    set((state) => {
      const key = keyOf(showId, season);
      if (!state.deltas.has(key)) return state;
      const next = new Map(state.deltas);
      next.delete(key);
      return { deltas: next };
    }),
}));

export function rememberSeasonMark(
  showId: number,
  season: number,
  episodes: readonly number[],
): void {
  useSeasonReversalStore.getState().remember(showId, season, episodes);
}

export function forgetSeasonMark(showId: number, season: number): void {
  useSeasonReversalStore.getState().forget(showId, season);
}

export function getSeasonMarkDelta(
  showId: number,
  season: number,
): ReadonlySet<number> | undefined {
  return useSeasonReversalStore.getState().deltas.get(keyOf(showId, season));
}
