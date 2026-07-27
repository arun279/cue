import { queryKeys } from "@data/query-keys";
import type { ShowInfo } from "@data/trakt/show-detail";
import { useQuery } from "@tanstack/react-query";
import { CONTENT_STALE_TIME_MS } from "@ui/hooks/query-freshness";
import { useRuntime } from "@ui/runtime/runtime";
import { useCallback, useState } from "react";

interface Art {
  readonly posters: readonly string[];
  readonly backdrops: readonly string[];
}

export interface ShowArtSlice extends Art {
  /** Attach to the card's root element: art is read only once it settles there. */
  readonly ref: (node: Element | null) => void;
}

const EMPTY = { posters: [], backdrops: [] } as const;

/** Module-level so TanStack can memoize the slice instead of re-deriving it per render. */
const selectArt = (info: ShowInfo): Art => ({ posters: info.posters, backdrops: info.backdrops });

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
 * The art is a slice of the shared `showInfo` entity, the SAME cache entry the
 * Show detail hero reads, so the two never fetch `/shows/:id` twice: a card that
 * already resolved hands its show's facts to the detail screen, and a show opened
 * from Search paints its card with no read at all. Returns the Trakt poster +
 * backdrop candidates for the image resolvers; empty lists (not yet resolved, or
 * a show with no art) fall through to the designed placeholder. Cached by trakt
 * id at the content horizon, and persisted for library shows, so a restored card
 * paints its poster offline.
 */
export function useShowArt(showId: number): ShowArtSlice {
  const runtime = useRuntime();
  const [ref, settled] = useSettledOnScreen();
  const query = useQuery({
    queryKey: queryKeys.showInfo(showId),
    queryFn: () => runtime.loadShowInfo(showId),
    staleTime: CONTENT_STALE_TIME_MS,
    enabled: settled,
    select: selectArt,
  });
  return { ref, ...(query.data ?? EMPTY) };
}
