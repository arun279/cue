import type { LibraryEntry } from "@cue/core/data/trakt/library";
import {
  type EpisodeView,
  firstUnwatchedAired,
  type SeasonView,
  type ShowHeader,
} from "@cue/core/data/trakt/show-detail";
import { epCode } from "@cue/core/domain/model/library";
import { isAired } from "@cue/core/domain/time";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { Link } from "@tanstack/react-router";
import { CheckControl } from "@ui/components/CheckControl";
import { CountdownPanel } from "@ui/components/CountdownPanel";
import { ProgressBar } from "@ui/components/ProgressBar";
import type { ReactElement, ReactNode } from "react";
import { continueKind } from "./detail-logic";

interface ContinueBarProps {
  readonly showId: number;
  readonly header: ShowHeader;
  /** The shared library entry, when the show is tracked: its optimistic advance
   * is what lets the bar roll to the next episode in place. */
  readonly entry: LibraryEntry | undefined;
  /** The optimistic season tree supplies fallback progress for watchlist-only
   * and budget-tail entries once it has loaded. */
  readonly seasons: readonly SeasonView[];
  readonly mark: MarkWatched;
  /** Mark for a show with no library entry yet (deep link / watchlist-only):
   * routed through the show-surface toggle instead of the queue pipeline. */
  onFallbackMark(episode: EpisodeView): void;
}

interface FallbackProgress {
  readonly aired: number;
  readonly completed: number;
  readonly nextEpisode: EpisodeView | null;
}

/**
 * Can the shared library entry drive this bar? Not the zero-progress watchlist
 * placeholder, and it must either name a next episode or be genuinely caught up.
 * A show past the cold-sync progress budget has real counts but no next-episode
 * identity, so the loaded season tree drives the bar instead.
 */
function isResolved(entry: LibraryEntry): boolean {
  if (entry.aired === 0 && entry.completed === 0) return false;
  return entry.nextEpisode !== null || entry.completed >= entry.aired;
}

function seasonProgress(seasons: readonly SeasonView[]): FallbackProgress {
  const airedEpisodes = seasons
    .filter((season) => !season.isSpecial && !season.isHidden)
    .flatMap((season) => season.episodes.filter((episode) => episode.aired));
  return {
    aired: airedEpisodes.length,
    completed: airedEpisodes.filter((episode) => episode.watched).length,
    nextEpisode: firstUnwatchedAired(seasons),
  };
}

function Shell({
  variant,
  children,
  trailing,
}: {
  readonly variant: string;
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
}): ReactElement {
  return (
    <section className="continue" data-testid="continue-bar" data-variant={variant}>
      {children}
      {trailing !== undefined && <span className="continue__check">{trailing}</span>}
    </section>
  );
}

function NextBody({
  showId,
  season,
  number,
  title,
  completed,
  aired,
}: {
  readonly showId: number;
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly completed: number;
  readonly aired: number;
}): ReactElement {
  const left = episodesLeft(aired, completed);
  return (
    <Link
      to="/show/$showId/episode/$season/$episode"
      params={{ showId: String(showId), season: String(season), episode: String(number) }}
      className="continue__body"
      data-testid="continue-episode-link"
    >
      <span className="continue__eyebrow">{completed === 0 ? "Start watching" : "Next"}</span>
      <span className="continue__line">
        <span className="continue__code">{epCode(season, number)}</span>
        {title !== null && ` · ${title}`}
      </span>
      <span className="continue__count">
        {completed === 0
          ? `${aired} episode${aired === 1 ? "" : "s"}`
          : `${completed} of ${aired} watched · ${left} left`}
      </span>
      <ProgressBar percent={watchedPercent(completed, aired)} className="continue__bar" />
    </Link>
  );
}

/** The tracked-show check: the identical advance-mode pipeline the Up Next queue
 * runs (optimistic advance, the undo window, then the advanced row). Its own
 * component so the hook has a stable home. */
function EntryCheck({
  entry,
  mark,
}: {
  readonly entry: LibraryEntry;
  readonly mark: MarkWatched;
}): ReactElement {
  const check = useMarkControl(entry, mark);
  return (
    <CheckControl
      state={check.state}
      size={48}
      mode="advance"
      label={check.label}
      testId="continue-check"
      pending={check.pending}
      onPress={check.onPress}
    />
  );
}

/**
 * The 72px sticky continue bar: NEXT eyebrow + episode line + series
 * progress with the check trailing; caught-up returning shows read the season
 * countdown, and a finished ended show reads its epitaph. When the shared
 * library entry is unavailable or not a real progress source, the loaded season
 * tree supplies optimistic progress and falls back to the detail header until it
 * loads. The check uses the fallback mark path. The bar body (not the check)
 * opens the episode sheet.
 */
export function ContinueBar({
  showId,
  header,
  entry,
  seasons,
  mark,
  onFallbackMark,
}: ContinueBarProps): ReactElement | null {
  const tracked = entry !== undefined && isResolved(entry);
  const fallback: FallbackProgress =
    seasons.length > 0
      ? seasonProgress(seasons)
      : { aired: header.aired, completed: header.completed, nextEpisode: header.nextEpisode };
  const aired = tracked ? entry.aired : fallback.aired;
  const completed = tracked ? entry.completed : fallback.completed;
  const next = tracked ? entry.nextEpisode : fallback.nextEpisode;

  // The optimistic advance projects a provisional next episode: keep the "next"
  // body (the check is mid-window/re-arming) instead of misreading it as done.
  const advancing = tracked && entry.pendingAdvance;
  const kind = advancing
    ? ({ kind: "next" } as const)
    : continueKind(
        next === null
          ? null
          : {
              season: next.season,
              aired: "aired" in next ? next.aired : isAired(next.firstAired, Date.now()),
              firstAired: next.firstAired,
            },
        header.status,
        aired,
        completed,
      );

  if (kind.kind === "next" && next !== null) {
    return (
      <Shell
        variant="next"
        trailing={
          tracked ? (
            <EntryCheck entry={entry} mark={mark} />
          ) : (
            <CheckControl
              state="unwatched"
              size={48}
              label={`Mark ${header.title} ${epCode(next.season, next.number)} watched`}
              testId="continue-check"
              onPress={() => {
                if (fallback.nextEpisode !== null) onFallbackMark(fallback.nextEpisode);
              }}
            />
          )
        }
      >
        <NextBody
          showId={showId}
          season={next.season}
          number={next.number}
          title={next.title}
          completed={completed}
          aired={aired}
        />
      </Shell>
    );
  }

  if (kind.kind === "returning") {
    return (
      <Shell variant="returning">
        <span className="continue__body">
          <span className="continue__line">All caught up</span>
          <span className="continue__count">
            <CountdownPanel
              mode="returning-season"
              date={kind.date}
              title={`S${kind.season} returns`}
            />
          </span>
        </span>
      </Shell>
    );
  }

  if (kind.kind === "finished") {
    return (
      <Shell variant="finished">
        <span className="continue__body">
          <span className="continue__line">Ended. You finished it.</span>
        </span>
      </Shell>
    );
  }

  return (
    <Shell variant="caught-up">
      <span className="continue__body">
        <span className="continue__line">All caught up</span>
      </span>
    </Shell>
  );
}
