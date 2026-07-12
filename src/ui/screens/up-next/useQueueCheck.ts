import type { LibraryEntry } from "@data/trakt/library";
import type { CheckState } from "@ui/components/CheckControl";
import { epCode } from "@ui/format";
import { reArmDelay } from "@ui/hooks/mark-undo-window";
import type { MarkWatched } from "@ui/hooks/useMarkWatched";
import { useEffect } from "react";

export interface QueueCheck {
  readonly state: CheckState;
  readonly label: string;
  onPress(): void;
}

/**
 * The queue-surface check grammar (marquee, queue rows, lapsed rows): unwatched
 * taps mark; a just-marked check is a live undo toggle until it re-arms; the
 * re-arm waits for the authoritative next episode (`pendingAdvance` cleared) and
 * the minimum visual window, never a guessed coordinate. A remount mid-advance
 * (window lost) renders plain watched: filled, inert, re-arming on refetch.
 */
export function useQueueCheck(entry: LibraryEntry, mark: MarkWatched): QueueCheck {
  const markedAt = mark.justMarkedAt(entry.showId);
  const { pendingAdvance, showId } = entry;
  const { reArm } = mark;

  useEffect(() => {
    if (markedAt === null) return;
    const delay = reArmDelay(markedAt, pendingAdvance, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => reArm(showId), delay);
    return () => clearTimeout(timer);
  }, [markedAt, pendingAdvance, showId, reArm]);

  if (entry.progressKnown === false) {
    return { state: "syncing", label: "", onPress: () => {} };
  }
  if (markedAt !== null) {
    return {
      state: "just-marked",
      label: "Watched. Tap to remove.",
      onPress: () => void mark.reverse(entry.showId),
    };
  }
  if (entry.pendingAdvance) {
    return { state: "watched", label: "Watched", onPress: () => {} };
  }
  const episode = entry.nextEpisode;
  const code = episode === null ? "" : epCode(episode.season, episode.number);
  return {
    state: "unwatched",
    label: `Mark ${entry.title} ${code} watched`,
    onPress: () => void mark.mark(entry),
  };
}
