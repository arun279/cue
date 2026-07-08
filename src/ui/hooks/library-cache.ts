import { queryKeys } from "@data/query-keys";
import type { LibraryEntry } from "@data/trakt/library";
import type { QueryClient } from "@tanstack/react-query";
import type { UpNextData } from "@ui/runtime/runtime";

/**
 * Optimistically replace one library entry in the shared SWR cache, holding the
 * find-by-showId + map + spread scaffolding in one place. Every optimistic library
 * flip (hidden, watchlist membership, mark-advance) runs through this rather than
 * re-inlining the same `entries.map(e => e.showId === id ? … : e)` block.
 */
export function patchLibraryEntry(
  qc: QueryClient,
  showId: number,
  update: (entry: LibraryEntry) => LibraryEntry,
): void {
  qc.setQueryData<UpNextData>(queryKeys.library(), (old) =>
    old === undefined
      ? old
      : { ...old, entries: old.entries.map((e) => (e.showId === showId ? update(e) : e)) },
  );
}

/** Optimistically flip a library entry's `hidden` (Stopped) flag in the shared SWR cache. */
export function patchLibraryHidden(qc: QueryClient, showId: number, hidden: boolean): void {
  patchLibraryEntry(qc, showId, (e) => ({ ...e, hidden }));
}

/** Whether the show currently sits in the hidden (Stopped) set, per the library cache. */
export function isLibraryHidden(qc: QueryClient, showId: number): boolean {
  const entries = qc.getQueryData<UpNextData>(queryKeys.library())?.entries;
  return entries?.find((e) => e.showId === showId)?.hidden ?? false;
}
