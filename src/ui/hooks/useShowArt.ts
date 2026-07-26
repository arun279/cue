import { queryKeys } from "@data/query-keys";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

export interface ShowArtSlice {
  /** Attach to the card's root element: art is read only once it settles there. */
  readonly ref: (node: Element | null) => void;
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
}

const EMPTY = { posters: [], backdrops: [] } as const;

/**
 * How long a card must hold still on screen before it is worth a GET. A card
 * flicked past crosses the viewport in well under this, so a scroll spends
 * nothing; a card the reader stops on resolves right after the scroll settles.
 */
const ART_SETTLE_MS = 250;

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
 * Deferred per-card show art. The bounded cold-sync read paints the queue and
 * buckets WITHOUT a per-show `/shows/:id` art fan-out; a card instead reads its
 * own poster/backdrop once it has settled on screen. Gating on the card being
 * LOOKED AT rather than merely mounted is what bounds a scroll: the Library grid
 * mounts every row it passes plus its overscan, and the queue mounts all of its
 * rows at once, so mounting alone spends a GET per show in the library.
 *
 * Returns the Trakt inline poster + backdrop candidates for the image resolvers;
 * empty lists (not yet resolved, or a show with no art) fall through to the
 * designed placeholder. Cached by trakt id at the content horizon and persisted,
 * so revisiting a card, or seeing the same show on two surfaces, never refetches
 * and a restored card paints its poster with no read at all.
 */
export function useShowArt(showId: number): ShowArtSlice {
  const runtime = useRuntime();
  const [ref, settled] = useSettledOnScreen();
  const query = useQuery({
    queryKey: queryKeys.showArt(showId),
    queryFn: () => runtime.loadShowArt(showId),
    staleTime: CONTENT_STALE_TIME_MS,
    enabled: settled,
  });
  return { ref, ...(query.data ?? EMPTY) };
}
