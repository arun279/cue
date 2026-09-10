import { useMemo } from "react";
import type { LibraryEntry } from "../data/trakt/library";
import { useLibrarySnapshot } from "./useLibrarySnapshot";

export function useLibraryEntry(showId: number): LibraryEntry | undefined {
  const { data } = useLibrarySnapshot();
  return useMemo(() => data?.entries.find((entry) => entry.showId === showId), [data, showId]);
}
