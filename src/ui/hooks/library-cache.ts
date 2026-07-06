import { queryKeys } from "@data/query-keys";
import type { QueryClient } from "@tanstack/react-query";
import type { UpNextData } from "@ui/runtime/runtime";

/** Optimistically flip a library entry's `hidden` (Stopped) flag in the shared SWR cache. */
export function patchLibraryHidden(qc: QueryClient, showId: number, hidden: boolean): void {
  qc.setQueryData<UpNextData>(queryKeys.library(), (old) =>
    old === undefined
      ? old
      : { ...old, entries: old.entries.map((e) => (e.showId === showId ? { ...e, hidden } : e)) },
  );
}

/** Whether the show currently sits in the hidden (Stopped) set, per the library cache. */
export function isLibraryHidden(qc: QueryClient, showId: number): boolean {
  const entries = qc.getQueryData<UpNextData>(queryKeys.library())?.entries;
  return entries?.find((e) => e.showId === showId)?.hidden ?? false;
}
