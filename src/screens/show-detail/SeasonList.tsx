import { type ReactElement, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { EpisodeView, SeasonView } from "@/core/domain/show-detail";
import { orderSeasons } from "@/core/domain/show-detail";
import { SeasonRow } from "./SeasonRow";

export interface SeasonListProps {
  readonly showId: number;
  readonly seasons: readonly SeasonView[];
  readonly initial: number | null;
  readonly onConfirm: (season: SeasonView) => void;
  readonly onMark: (episode: EpisodeView) => void;
  readonly onOpen: (episode: EpisodeView) => void;
}

export function SeasonList({
  showId,
  seasons,
  initial,
  onConfirm,
  onMark,
  onOpen,
}: SeasonListProps): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<number> | null>(null);
  const actions = useRef({ onConfirm, onMark, onOpen });
  useLayoutEffect(() => {
    actions.current = { onConfirm, onMark, onOpen };
  });
  const toggle = useCallback(
    (number: number) =>
      setExpanded((previous) => {
        const next = new Set(previous ?? (initial === null ? [] : [initial]));
        if (next.has(number)) next.delete(number);
        else next.add(number);
        return next;
      }),
    [initial],
  );
  const confirm = useCallback((season: SeasonView) => actions.current.onConfirm(season), []);
  const mark = useCallback((episode: EpisodeView) => actions.current.onMark(episode), []);
  const open = useCallback((episode: EpisodeView) => actions.current.onOpen(episode), []);
  const shown = expanded ?? new Set(initial === null ? [] : [initial]);
  return (
    <>
      {orderSeasons(seasons).map((season) => (
        <SeasonRow
          key={season.number}
          showId={showId}
          season={season}
          expanded={shown.has(season.number)}
          onExpand={toggle}
          onConfirm={confirm}
          onMark={mark}
          onOpen={open}
        />
      ))}
    </>
  );
}
