import { upNextEmptyKind } from "@cue/core/domain/up-next";
import { stopWatching, useHideShow } from "@cue/core/hooks/useHideShow";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import { type MarkWatched, useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useOnTheWay } from "@cue/core/hooks/useOnTheWay";
import { useStopSnacks } from "@cue/core/hooks/useStopSnacks";
import { type UpNextCard, useUpNext } from "@cue/core/hooks/useUpNext";
import { Link } from "@tanstack/react-router";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { MarqueeCard } from "@ui/components/MarqueeCard";
import { PosterTile } from "@ui/components/PosterTile";
import { PullToRefresh } from "@ui/components/PullToRefresh";
import { SectionHeader } from "@ui/components/SectionHeader";
import { SkeletonMarquee, SkeletonRows } from "@ui/components/Skeletons";
import {
  initialTutorialDismissed,
  persistTutorialDismissed,
  TutorialCaption,
} from "@ui/components/TutorialCaption";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useFlip } from "@ui/hooks/useFlip";
import { type ReactElement, type ReactNode, useState } from "react";
import { LapsedDrawer } from "./LapsedDrawer";
import { MAX_ROWS, OnTheWay } from "./OnTheWay";
import { Previously } from "./Previously";
import { QueueRow } from "./QueueRow";

/** The marquee's check shares the queue grammar; a thin slot component so the
 * check-state hook has a stable home per card. */
function MarqueeSlot({
  card,
  mark,
}: {
  readonly card: UpNextCard;
  readonly mark: MarkWatched;
}): ReactElement {
  const check = useMarkControl(card.entry, mark);
  return (
    <MarqueeCard
      entry={card.entry}
      episode={card.item.episode}
      checkState={check.state}
      checkLabel={check.label}
      checkPending={check.pending}
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

  useStopSnacks(stop);
  const onTheWay = useOnTheWay(MAX_ROWS);

  const showSections = view.hasData && !view.isLoading;
  const marquee = view.queue.length >= 3 ? view.queue[0] : undefined;
  const rows = marquee === undefined ? view.queue : view.queue.slice(1);

  const emptyKind = upNextEmptyKind({ ...view, queued: view.queue.length });

  // What sits under an empty queue in both branches that have one: when the
  // queue does not resolve, "so when do I get something?" is still the question.
  const timeline: ReactNode = (
    <>
      <OnTheWay days={onTheWay} />
      <LapsedDrawer
        cards={view.lapsedCards}
        mark={mark}
        onStop={(card) => stopWatching(stop, card.entry)}
      />
      <Previously />
    </>
  );

  const watchlistTiles: ReactNode = view.watchlistEntries.length > 0 && (
    <div className="home-section">
      <SectionHeader label="From your watchlist" />
      <div className="poster-tile-grid">
        {view.watchlistEntries.slice(0, 3).map((entry) => (
          <PosterTile
            key={entry.showId}
            showId={entry.showId}
            title={entry.title}
            testId="watchlist-tile"
          />
        ))}
      </div>
    </div>
  );

  return (
    <section className="screen-home" data-testid="screen-up-next">
      <ScreenHeader title="Up Next" variant="root" />
      <SyncStrip status={view} onRetry={view.refetch} />

      <PullToRefresh>
        {view.isLoading && (
          <div data-testid="up-next-skeleton">
            <SkeletonMarquee />
            <SkeletonRows />
          </div>
        )}

        {!view.isLoading && view.isError && !view.hasData && (
          <ErrorRetry
            title="Couldn't load your queue"
            failure={view.failure}
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
            {timeline}
          </>
        )}

        {showSections && emptyKind === "caught-up" && (
          <>
            <EmptyState
              testId="empty-all-caught-up"
              headline="You're all caught up."
              body={onTheWay.length === 0 ? "Nothing airing in the next few days." : undefined}
            />
            {timeline}
          </>
        )}

        {showSections && emptyKind === null && (
          <>
            {marquee !== undefined && <MarqueeSlot card={marquee} mark={mark} />}

            {rows.length > 0 && (
              <ul className="row-list" data-testid="up-next-list">
                {rows.map((card, index) => (
                  <li key={card.entry.showId} ref={flip.ref(card.entry.showId)}>
                    <QueueRow
                      card={card}
                      mark={mark}
                      onStop={() => stopWatching(stop, card.entry)}
                    />
                    {index === 0 && !tutorialDismissed && <TutorialCaption />}
                  </li>
                ))}
              </ul>
            )}

            <LapsedDrawer
              cards={view.lapsedCards}
              mark={mark}
              onStop={(card) => stopWatching(stop, card.entry)}
            />
            <OnTheWay days={onTheWay} />
            <Previously />
          </>
        )}
      </PullToRefresh>
    </section>
  );
}
