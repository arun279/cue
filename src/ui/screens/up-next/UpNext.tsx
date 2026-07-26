import { Link } from "@tanstack/react-router";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { MarqueeCard } from "@ui/components/MarqueeCard";
import { PosterTile } from "@ui/components/PosterTile";
import { SectionHeader } from "@ui/components/SectionHeader";
import { SkeletonMarquee, SkeletonRows } from "@ui/components/Skeletons";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import {
  initialTutorialDismissed,
  persistTutorialDismissed,
  TutorialCaption,
} from "@ui/components/TutorialCaption";
import { useCalendar } from "@ui/hooks/useCalendar";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useFlip } from "@ui/hooks/useFlip";
import { useHideShow } from "@ui/hooks/useHideShow";
import { type MarkWatched, useMarkWatched } from "@ui/hooks/useMarkWatched";
import { type UpNextCard, useUpNext } from "@ui/hooks/useUpNext";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { LapsedDrawer } from "./LapsedDrawer";
import { buildOnTheWay, OnTheWay, useOnTheWayClock } from "./OnTheWay";
import { Previously } from "./Previously";
import { QueueRow } from "./QueueRow";
import { useQueueCheck } from "./useQueueCheck";

/** The marquee's check shares the queue grammar; a thin slot component so the
 * check-state hook has a stable home per card. */
function MarqueeSlot({
  card,
  mark,
}: {
  readonly card: UpNextCard;
  readonly mark: MarkWatched;
}): ReactElement {
  const check = useQueueCheck(card.entry, mark);
  return (
    <MarqueeCard
      entry={card.entry}
      episode={card.item.episode}
      checkState={check.state}
      checkLabel={check.label}
      onCheck={check.onPress}
    />
  );
}

/**
 * Up Next is the home screen and the heart of Cue, one timeline of your watching
 * life. What's next on top (marquee + queue), what's coming below ("On the
 * way"), what you just did at the bottom ("Previously"); a mark visibly travels
 * down that timeline. Every state is designed: skeletons, five honest empty
 * branches on real library composition, and error = SyncStrip over cached
 * content, never a blank screen.
 */
export function UpNext(): ReactElement {
  useDocumentTitle("Up Next · Cue");
  const view = useUpNext();
  const markController = useMarkWatched();
  const stop = useHideShow();
  const calendar = useCalendar();
  const flip = useFlip();
  const [tutorialDismissed, setTutorialDismissed] = useState(initialTutorialDismissed);

  // The one-time caption dies on the first-ever mark, whatever row fires it.
  const mark: MarkWatched = {
    ...markController,
    mark: (entry) => {
      if (!tutorialDismissed) {
        persistTutorialDismissed();
        setTutorialDismissed(true);
      }
      return markController.mark(entry);
    },
  };

  const { undoable: stopUndoable, error: stopError, undo: stopUndo, clearError } = stop;
  useEffect(() => {
    if (stopError !== null) {
      showSnack({
        message: stopError,
        actions: [
          {
            label: "Dismiss",
            onPress: () => {
              clearError();
              dismissSnack();
            },
          },
        ],
      });
      return;
    }
    if (stopUndoable !== null) {
      showSnack({
        message: `${stopUndoable.title} ${stopUndoable.kind === "hide" ? "stopped" : "resumed"}`,
        actions: [
          {
            label: "Undo",
            testId: "snackbar-undo",
            onPress: () => {
              dismissSnack();
              void stopUndo();
            },
          },
        ],
      });
    }
  }, [stopUndoable, stopError, stopUndo, clearError]);

  // The coarse hourly clock keeps "Tonight" honest: an episode that airs while
  // the screen sits open drops out on the next hour flip.
  const clock = useOnTheWayClock();
  const onTheWay = useMemo(() => buildOnTheWay(calendar.days, clock), [calendar.days, clock]);

  const stopWatching = (card: UpNextCard): void => {
    void stop.hide(
      card.entry.showId,
      { trakt: card.entry.showId, tmdb: card.entry.tmdbId ?? undefined },
      card.entry.title,
    );
  };

  const showSections = view.hasData && !view.isLoading;
  const marquee = view.queue.length >= 3 ? view.queue[0] : undefined;
  const rows = marquee === undefined ? view.queue : view.queue.slice(1);

  // The empty states branch on real library composition so the home screen never
  // tells a user the opposite of their state: a library of only Stopped shows must
  // not read "nothing queued", only-Watchlist must not read "all caught up", and
  // shows with episodes left whose next episode is still unknown must not be
  // counted as caught up either. Exactly one fires, only when no card renders.
  const emptyKind:
    | "nothing-tracked"
    | "only-stopped"
    | "nothing-started"
    | "unresolved"
    | "caught-up"
    | null =
    !view.hasData || view.queue.length > 0
      ? null
      : view.totalCount === 0
        ? "nothing-tracked"
        : view.trackedCount === 0
          ? "only-stopped"
          : view.startedCount === 0
            ? "nothing-started"
            : view.unresolvedCount > 0
              ? "unresolved"
              : "caught-up";

  const watchlistTiles: ReactNode = view.watchlistEntries.length > 0 && (
    <div className="home-section">
      <SectionHeader label="From your watchlist" />
      <div className="poster-tile-grid">
        {view.watchlistEntries.slice(0, 3).map((entry) => (
          <PosterTile
            key={entry.showId}
            showId={entry.showId}
            title={entry.title}
            posters={entry.posters}
            testId="watchlist-tile"
          />
        ))}
      </div>
    </div>
  );

  return (
    <section className="screen-home" data-testid="screen-up-next">
      <ScreenHeader title="Up Next" variant="root" />
      <SyncStrip isError={view.isError} onRetry={view.refetch} />

      {view.isLoading && (
        <div data-testid="up-next-skeleton">
          <SkeletonMarquee />
          <SkeletonRows />
        </div>
      )}

      {!view.isLoading && view.isError && !view.hasData && (
        <ErrorRetry
          title="Couldn't load your queue"
          testId="up-next-error"
          buttonTestId="up-next-error-retry"
          onRetry={view.refetch}
        />
      )}

      {showSections && emptyKind === "nothing-tracked" && (
        <EmptyState
          testId="empty-nothing-tracked"
          headline="Nothing queued."
          body="Find a show and Cue keeps your place."
        >
          <Link to="/search" className="button" data-testid="empty-search-shows">
            Search shows
          </Link>
        </EmptyState>
      )}

      {showSections && emptyKind === "only-stopped" && (
        <EmptyState
          testId="empty-only-stopped"
          headline="All your shows are stopped."
          body="Resume one to bring it back into your queue. Your watch history is kept."
        >
          <Link to="/library" className="button button--ghost" data-testid="empty-to-library">
            Go to Library
          </Link>
        </EmptyState>
      )}

      {showSections && emptyKind === "nothing-started" && (
        <>
          <EmptyState
            testId="empty-nothing-started"
            headline="Nothing queued."
            body="Find a show and Cue keeps your place."
          >
            <Link to="/search" className="button" data-testid="empty-search-shows">
              Search shows
            </Link>
          </EmptyState>
          {watchlistTiles}
        </>
      )}

      {showSections && emptyKind === "unresolved" && (
        <>
          <EmptyState
            testId="empty-unresolved"
            headline="Nothing to queue right now."
            body="Shows with episodes left are waiting in your Library."
          >
            <Link to="/library" className="button button--ghost" data-testid="empty-to-library">
              Go to Library
            </Link>
          </EmptyState>
          <OnTheWay days={onTheWay} />
          <LapsedDrawer cards={view.lapsedCards} mark={mark} onStop={stopWatching} />
          <Previously />
        </>
      )}

      {showSections && emptyKind === "caught-up" && (
        <>
          <EmptyState
            testId="empty-all-caught-up"
            headline="You're all caught up."
            body={onTheWay.length === 0 ? "Nothing airing in the next few days." : undefined}
          />
          <OnTheWay days={onTheWay} />
          <LapsedDrawer cards={view.lapsedCards} mark={mark} onStop={stopWatching} />
          <Previously />
        </>
      )}

      {showSections && emptyKind === null && (
        <>
          {marquee !== undefined && <MarqueeSlot card={marquee} mark={mark} />}

          {rows.length > 0 && (
            <ul className="row-list" data-testid="up-next-list">
              {rows.map((card, index) => (
                <li key={card.entry.showId} ref={flip.ref(card.entry.showId)}>
                  <QueueRow card={card} mark={mark} onStop={() => stopWatching(card)} />
                  {index === 0 && !tutorialDismissed && <TutorialCaption />}
                </li>
              ))}
            </ul>
          )}

          <LapsedDrawer cards={view.lapsedCards} mark={mark} onStop={stopWatching} />
          <OnTheWay days={onTheWay} />
          <Previously />
        </>
      )}
    </section>
  );
}
