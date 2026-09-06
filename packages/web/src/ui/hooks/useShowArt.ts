import {
  ART_SETTLE_MS,
  type ShowArt,
  useShowArt as useShowArtQuery,
} from "@cue/core/hooks/useShowArt";
import { useCallback, useState } from "react";

export interface ShowArtSlice extends ShowArt {
  /** Attach to the card's root element: art is read only once it settles there. */
  readonly ref: (node: Element | null) => void;
}

/** Latches true once the element has held still on screen for {@link ART_SETTLE_MS}. */
function useSettledOnScreen(): [(node: Element | null) => void, boolean] {
  const [settled, setSettled] = useState(false);
  const ref = useCallback((node: Element | null) => {
    if (node === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([hit]) => {
      clearTimeout(timer);
      if (hit?.isIntersecting !== true) return;
      timer = setTimeout(() => {
        observer.disconnect();
        setSettled(true);
      }, ART_SETTLE_MS);
    });
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  return [ref, settled];
}

/**
 * The browser's answer to "has this card settled": gating on the card being
 * LOOKED AT rather than merely mounted is what bounds a scroll, because the
 * Library grid mounts every row it passes plus its overscan and the queue mounts
 * all of its rows at once, so mounting alone spends a GET per show in the
 * library.
 */
export function useShowArt(showId: number): ShowArtSlice {
  const [ref, settled] = useSettledOnScreen();
  return { ref, ...useShowArtQuery(showId, settled) };
}
