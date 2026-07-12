import type { LibraryEntry } from "@data/trakt/library";
import { Link } from "@tanstack/react-router";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { CheckControl } from "@ui/components/CheckControl";
import { EmptyState } from "@ui/components/EmptyState";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { MarqueeCard } from "@ui/components/MarqueeCard";
import { PosterTile } from "@ui/components/PosterTile";
import { ProgressBar } from "@ui/components/ProgressBar";
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
import { useShowArt } from "@ui/hooks/useShowArt";
import { type UpNextCard, useUpNext } from "@ui/hooks/useUpNext";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { LapsedDrawer } from "./LapsedDrawer";
import { buildOnTheWay, OnTheWay } from "./OnTheWay";
import { Poster } from "./Poster";
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

/** A show beyond the progress budget: poster + title, striped bar, disabled
 * check. Opening the row's show detail triggers its on-demand progress fetch. */
function SyncPendingRow({ entry }: { readonly entry: LibraryEntry }): ReactElement {
  const art = useShowArt(entry.showId);
  const posters = art.posters.length > 0 ? art.posters : entry.posters;
  return (
    <EpisodeRow
      variant="queue"
      testId="sync-pending-row"
      showId={entry.showId}
      art={<Poster title={entry.title} posters={posters} variant="s48" />}
      title={entry.title}
      meta="Syncing progress…"
      footer={<ProgressBar striped className="ep-row__bar" />}
      trailing={<CheckControl state="syncing" size={48} label="" />}
      link={{ to: "/show/$showId", params: { showId: String(entry.showId) } }}
      linkLabel={entry.title}
    />
  );
}

/**
 * Up Next: the home screen and the heart of Cue — one timeline of your watching
 * life. What's next on top (marquee + queue), what's coming below ("On the
 * way"), what you just did at the bottom ("Previously"); a mark visibly travels
 * down that timeline. Every state is designed: skeletons, four honest empty
 * branches on real library composition, sync-pending rows for the un-synced
 * tail, and error = SyncStrip over cached content, never a blank screen.
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

  const onTheWay = useMemo(() => buildOnTheWay(calendar.days, Date.now()), [calendar.days]);

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

  // The four empty states branch on real library composition so the home screen
  // never tells a user the opposite of their state: a library of only Stopped
  // shows must not read "nothing queued", and only-Watchlist must not read "all
  // caught up". Exactly one fires, only when nothing (queued or syncing) renders.
  const emptyKind: "nothing-tracked" | "only-stopped" | "nothing-started" | "caught-up" | null =
    !view.hasData || view.queue.length > 0 || view.syncPending.length > 0
      ? null
      : view.totalCount === 0
        ? "nothing-tracked"
        : view.trackedCount === 0
          ? "only-stopped"
          : view.startedCount === 0
            ? "nothing-started"
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

      {showSections && emptyKind === "caught-up" && (
        <>
          <EmptyState
            testId="empty-all-caught-up"
            headline="You're all caught up."
            body={
              onTheWay.length === 0
                ? "Nothing airing this week — your shows are between seasons."
                : undefined
            }
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
            <ul className="row-list row-list--queue" data-testid="up-next-list">
              {rows.map((card, index) => (
                <li key={card.entry.showId} ref={flip.ref(card.entry.showId)}>
                  <QueueRow card={card} mark={mark} onStop={() => stopWatching(card)} />
                  {index === 0 && !tutorialDismissed && <TutorialCaption />}
                </li>
              ))}
            </ul>
          )}

          {view.syncPending.length > 0 && (
            <ul className="row-list" data-testid="sync-pending-list">
              {view.syncPending.map((entry) => (
                <li key={entry.showId}>
                  <SyncPendingRow entry={entry} />
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
