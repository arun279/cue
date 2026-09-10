import { useMemo } from "react";
import type { LibraryEntry } from "../data/trakt/library";
import { chipBuckets, type LibraryChips, type LibrarySort } from "../domain/library-buckets";
import { type QueryStatus, queryStatus } from "../queries/freshness";
import { useLibrarySnapshot } from "./useLibrarySnapshot";

export interface LibraryChipsView extends QueryStatus {
  readonly chips: LibraryChips<LibraryEntry>;
  refetch(): void;
}

/**
 * The Library shows read hook: the same persisted `library` snapshot Up Next
 * paints from, grouped into the status chips against the live staleness
 * threshold. Reuses the shared cache so the screen paints instantly on
 * navigation with no extra fetch.
 */
export function useLibraryBuckets(sort: LibrarySort, enabled = true): LibraryChipsView {
  const { query, data, thresholdMs } = useLibrarySnapshot(enabled);

  const chips = useMemo<LibraryChips<LibraryEntry>>(
    () => chipBuckets(data?.entries ?? [], Date.now(), thresholdMs, sort),
    [data, thresholdMs, sort],
  );

  return {
    chips,
    ...queryStatus(query, data !== undefined),
    refetch: () => void query.refetch(),
  };
}
