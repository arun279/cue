import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ART_SETTLE_MS,
  EMPTY_SHOW_ART,
  type ShowArt,
  selectArt,
  showInfoQuery,
} from "@/core/queries/shows";
import { useRuntime } from "@/core/runtime/runtime";

export function useShowArt(showId: number, enabled = true): ShowArt {
  const runtime = useRuntime();
  const [settled, setSettled] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(showId), ART_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [showId]);

  return (
    useQuery({
      ...showInfoQuery(runtime, showId),
      enabled: enabled && settled === showId,
      select: selectArt,
    }).data ?? EMPTY_SHOW_ART
  );
}
