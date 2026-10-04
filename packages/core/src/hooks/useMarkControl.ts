import { useEffect, useState } from "react";
import type { LibraryEntry } from "../data/trakt/library";
import { epCode } from "../domain/model/library";
import { useMarkStore } from "../stores/mark-store";
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

export function useMarkControl(entry: LibraryEntry, mark: MarkWatched): MarkControl {
  const markedAt = useMarkStore((state) => state.records.get(entry.showId)?.at ?? null);
  const { pendingAdvance, showId } = entry;
  const { reArm } = mark;
  const [, setTick] = useState(0);

  useEffect(() => {
    const delay = markControlTickMs(markedAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [markedAt]);

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
