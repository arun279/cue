import {
  ART_SETTLE_MS,
  type ShowArt,
  useShowArt as useShowArtQuery,
} from "@cue/core/hooks/useShowArt";
import { useEffect, useState } from "react";

/**
 * The native answer to "has this card settled": a virtualized list unmounts or
 * recycles a row the reader scrolls past well inside the settle window, so a
 * flick down the queue spends nothing and a row the reader stops on resolves
 * right after the scroll does.
 *
 * What settles is a SHOW rather than a mount. A recycled cell keeps its state,
 * so a mount-scoped flag would arrive already settled and read a `/shows/:id`
 * for every row the reader passes.
 */
export function useShowArt(showId: number): ShowArt {
  const [settled, setSettled] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(showId), ART_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [showId]);

  return useShowArtQuery(showId, settled === showId);
}
