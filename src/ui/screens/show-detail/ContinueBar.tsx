import type { LibraryEntry } from "@data/trakt/library";
import type { ShowHeader } from "@data/trakt/show-detail";
import { isAired } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { CheckControl } from "@ui/components/CheckControl";
import { CountdownPanel } from "@ui/components/CountdownPanel";
import { ProgressBar } from "@ui/components/ProgressBar";
import { epCode, episodesLeft, watchedPercent } from "@ui/format";
import type { MarkWatched } from "@ui/hooks/useMarkWatched";
import { useQueueCheck } from "@ui/screens/up-next/useQueueCheck";
import type { ReactElement, ReactNode } from "react";
import { continueKind } from "./detail-logic";

interface ContinueBarProps {
  readonly showId: number;
  readonly header: ShowHeader;
  /** The shared library entry, when the show is tracked: its optimistic advance
   * is what lets the bar roll to the next episode in place. */
  readonly entry: LibraryEntry | undefined;
  readonly mark: MarkWatched;
  /** Mark for a show with no library entry yet (deep link / watchlist-only):
   * routed through the show-surface toggle instead of the queue pipeline. */
  onFallbackMark(): void;
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
 * runs (optimistic advance, live reverse window, re-arm on the authoritative
 * next episode). Its own component so the hook has a stable home. */
function EntryCheck({
  entry,
  mark,
}: {
  readonly entry: LibraryEntry;
  readonly mark: MarkWatched;
}): ReactElement {
  const check = useQueueCheck(entry, mark);
  return (
    <CheckControl
      state={check.state}
      size={48}
      mode="advance"
      label={check.label}
      testId="continue-check"
      onPress={check.onPress}
    />
  );
}

/**
 * The 72px sticky continue bar (§3.3.2): NEXT eyebrow + episode line + series
 * progress with the check trailing; caught-up returning shows read the season
 * countdown, a finished ended show reads its epitaph, and a show still beyond
 * the progress budget reads the striped syncing state with a disabled check.
 * The bar body (not the check) opens the episode sheet.
 */
export function ContinueBar({
  showId,
  header,
  entry,
  mark,
  onFallbackMark,
}: ContinueBarProps): ReactElement | null {
  if (entry !== undefined && !entry.progressKnown) {
    return (
      <Shell
        variant="syncing"
        trailing={<CheckControl state="syncing" size={48} label="" testId="continue-check" />}
      >
        <span className="continue__body">
          <span className="continue__line continue__line--muted">Syncing your history…</span>
          <ProgressBar striped className="continue__bar" />
        </span>
      </Shell>
    );
  }

  const tracked = entry?.progressKnown;
  const aired = tracked ? entry.aired : header.aired;
  const completed = tracked ? entry.completed : header.completed;
  const next = tracked ? entry.nextEpisode : header.nextEpisode;

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
              onPress={onFallbackMark}
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
