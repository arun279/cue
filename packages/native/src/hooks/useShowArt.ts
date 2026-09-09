import {
  ART_SETTLE_MS,
  type ShowArt,
  useShowArt as useShowArtQuery,
} from "@cue/core/hooks/useShowArt";
import { useEffect, useState } from "react";

/**
 * The native answer to "has this card settled": a card that stays mounted for
 * the settle window is one the reader has arrived at, so a card the list tears
 * down before then spends nothing.
 *
 * What settles is a SHOW rather than a mount, because a cell reused for a second
 * show keeps its state and a mount-scoped flag would arrive already settled.
 *
 * This is a weaker bound than the browser's, which watches what is on screen:
 * `VirtualizedList` keeps ten screens of rows mounted either side, so a row
 * scrolled past is still a row read. It holds for a one column queue, where
 * mounted and looked at are within a screen of each other. A grid is the case
 * where it does not, and the screen that has one drives this off the list's own
 * report of what is on screen instead.
 */
export function useShowArt(showId: number): ShowArt {
  const [settled, setSettled] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(showId), ART_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [showId]);

  return useShowArtQuery(showId, settled === showId);
}
