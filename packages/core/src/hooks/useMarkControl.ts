import { useEffect, useState } from "react";
import type { LibraryEntry } from "../data/trakt/library";
import { epCode } from "../domain/model/library";
import {
  type MarkControlView,
  markControlTickMs,
  markRecordRetireMs,
  resolveMarkControl,
} from "../sync-contract";
import type { MarkWatched } from "./useMarkWatched";

export interface MarkControl extends MarkControlView {
  onPress(): void;
}

/**
 * The queue-surface mark control (marquee, queue rows, lapsed rows), bound to
 * the shared contract so both apps render the same grammar.
 *
 * Everything visible here moves on the clock. The row advances the instant it is
 * tapped and the green undo window closes on schedule, whether or not the write
 * has reached Trakt: the durable queue guarantees delivery, so a rate limit or
 * an offline stretch defers the POST without ever leaving the row looking
 * marked-and-stuck. The one thing that still waits for Trakt is the RIGHT to
 * mark again, because the next episode is a client projection until a real read
 * names it, and marking a guessed coordinate is forbidden.
 */
export function useMarkControl(entry: LibraryEntry, mark: MarkWatched): MarkControl {
  const markedAt = mark.justMarkedAt(entry.showId);
  const { pendingAdvance, showId } = entry;
  const { reArm } = mark;
  const [, setTick] = useState(0);

  // Re-render exactly when the contract's state change is due, the close of the
  // undo window. Nothing else about this control is scheduled: it is what makes
  // the row advance on the clock instead of on a response.
  useEffect(() => {
    const delay = markControlTickMs(markedAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [markedAt]);

  // Retiring the show's record re-arms the check for a real next episode, so it
  // waits for the authoritative one to land as well as for the window to run.
  useEffect(() => {
    if (markedAt === null) return;
    const delay = markRecordRetireMs(markedAt, pendingAdvance, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => reArm(showId), delay);
    return () => clearTimeout(timer);
  }, [markedAt, pendingAdvance, showId, reArm]);

  const episode = entry.nextEpisode;
  const view = resolveMarkControl({
    markedAt,
    pendingAdvance,
    title: entry.title,
    episodeCode: episode === null ? "" : epCode(episode.season, episode.number),
    now: Date.now(),
  });

  if (view.state === "just-marked") {
    return { ...view, onPress: () => void mark.reverse(showId) };
  }
  if (view.state === "unwatched") {
    return { ...view, onPress: () => void mark.mark(entry) };
  }
  return { ...view, onPress: () => {} };
}
