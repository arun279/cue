import { create } from "zustand";

/**
 * Session record of reversible season marks. When a `Mark season
 * watched` completes a season it stores that mark's OWN delta: the aired,
 * previously-unwatched episode numbers it added a play to. The durable "Unmark" on a
 * completed season reverses exactly this delta (never a pre-existing play), so the
 * mark can be undone minutes later, long after the transient toast is gone, without
 * wiping watch history it never created.
 *
 * In-memory only: it survives navigation within a session but not a reload. That is
 * deliberate: after a reload there is no "mark you just made" to reverse, and the
 * reload-durable, per-play-safe home for editing genuine history is the Diary (and
 * the per-episode uncheck). Because it is never persisted it can never leak a stale
 * delta across a reload or a different account, and because the unmark always
 * re-resolves LIVE plays and keeps rewatches, even a stale in-session delta can only
 * ever remove a play the mark still owns.
 */
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

/** The remembered mark delta for a season, or `undefined` if none is on record. */
export function getSeasonMarkDelta(
  showId: number,
  season: number,
): ReadonlySet<number> | undefined {
  return useSeasonReversalStore.getState().deltas.get(keyOf(showId, season));
}
