import {
  ART_SETTLE_MS,
  EMPTY_SHOW_ART,
  type ShowArt,
  selectArt,
  showInfoQuery,
} from "@cue/core/queries/shows";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// VirtualizedList keeps about ten screens of rows mounted on each side, so a grid passes onScreen.
export function useShowArt(showId: number, onScreen = true): ShowArt {
  const runtime = useRuntime();
  const [settled, setSettled] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(showId), ART_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [showId]);

  return (
    useQuery({
      ...showInfoQuery(runtime, showId),
      enabled: onScreen && settled === showId,
      select: selectArt,
    }).data ?? EMPTY_SHOW_ART
  );
}
