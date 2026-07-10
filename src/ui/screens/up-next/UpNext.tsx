import { Link } from "@tanstack/react-router";
import { CachedRetryBanner } from "@ui/components/CachedRetryBanner";
import { CardListSkeleton } from "@ui/components/CardListSkeleton";
import { ErrorRetry, ErrorToast } from "@ui/components/ErrorStates";
import { Snackbar } from "@ui/components/Snackbar";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useHideShow } from "@ui/hooks/useHideShow";
import { useMarkWatched } from "@ui/hooks/useMarkWatched";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import { useUpNext } from "@ui/hooks/useUpNext";
import type { ReactElement, ReactNode } from "react";
import emptyAllCaughtUp from "./assets/empty-all-caught-up.webp";
import emptyNothingTracked from "./assets/empty-nothing-tracked.webp";
import { LapsedDrawer } from "./LapsedDrawer";
import { UpNextCard } from "./UpNextCard";

const UNDO_MS = 6000;

/** The point-of-action Undo target: the show whose mark just landed + its
 * just-marked episode code, so whichever list card now holds that show (it may have
 * re-sorted from the lapsed drawer into Continue) carries the inline Undo. */
interface UndoTarget {
  readonly showId: number;
  readonly code: string;
  onUndo(): void;
}

/** One card-list for a group; only its first card renders as the `lead` when this
 * group holds the very first card of the honest sort (`leadFirst`). */
function QueueList({
  cards,
  leadFirst,
  listTestId,
  undoTarget,
  onMark,
}: {
  readonly cards: readonly UpNextCardModel[];
  readonly leadFirst: boolean;
  readonly listTestId?: string;
  readonly undoTarget: UndoTarget | null;
  onMark(card: UpNextCardModel): void;
}): ReactElement {
  return (
    <ul className="card-list" data-testid={listTestId}>
      {cards.map((card, index) => (
        <li key={card.entry.showId}>
          <UpNextCard
            card={card}
            variant={leadFirst && index === 0 ? "lead" : "queue"}
            undo={
              undoTarget?.showId === card.entry.showId
                ? { code: undoTarget.code, onUndo: undoTarget.onUndo }
                : undefined
            }
            onMark={() => onMark(card)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The one-tap Upcoming affordance — Calendar demoted from a tab to a view inside
 * Up Next. Icon-only with an accessible name so it never widens the head and
 * pushes the queue below the fold (the icon-only-with-name pattern of). */
function UpcomingLink(): ReactElement {
  return (
    <Link
      to="/calendar"
      className="up-next-upcoming"
      data-testid="up-next-upcoming"
      aria-label="Upcoming episodes"
      title="Upcoming episodes"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M7 2v3m10-3v3M3 8h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      </svg>
    </Link>
  );
}

function EmptyState({
  testId,
  art,
  title,
  body,
  action,
}: {
  testId: string;
  art: string;
  title: string;
  body: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="empty" data-testid={testId}>
      <img className="empty__art" src={art} alt="" />
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  );
}

/**
 * Up Next — the home screen and the honest heart of Cue. It shows only in-progress
 * shows with an unwatched AIRED next episode, partitioned on verifiable facts: a
 * "New" group (this week's freshly-aired episodes, hidden when empty), then a
 * "Continue" group (mid-run, your-own-recency order). The very first card of the
 * sort renders as a calmer `lead` (first-in-sort, not a recommendation). Idle
 * in-progress shows collapse into the "Haven't watched in a while" drawer at the
 * bottom. Every state is designed: skeleton, hard-error retry, and four honest
 * empty states branched on real library composition (nothing-tracked /
 * only-stopped / nothing-started / caught-up). Marking is optimistic with Undo.
 */
export function UpNext(): ReactElement {
  useDocumentTitle("Up Next · Cue");
  const view = useUpNext();
  const mark = useMarkWatched();
  const stop = useHideShow();

  const markCard = (card: UpNextCardModel): void => void mark.markWatched(card.entry);

  // The just-marked show's card carries the PRIMARY reversal inline; the toast
  // below is the SECONDARY polite announcement. A finished show leaves the queue, so no
  // card matches — the toast + durable History reversal cover that case.
  const undoTarget: UndoTarget | null =
    mark.undoable === null
      ? null
      : {
          showId: mark.undoable.showId,
          code: mark.undoable.episodeCode,
          onUndo: () => void mark.undo(),
        };

  const hasActive = view.newCards.length > 0 || view.continueCards.length > 0;
  const hasLapsed = view.lapsedCards.length > 0;
  const showSections = view.hasData && !view.isLoading;

  // The four empty states are branched on real library composition so the home
  // screen never tells a user the opposite of their state: a library of only
  // Stopped shows must not read "nothing tracked", and only-Watchlist must not
  // read "all caught up". Exactly one fires, only when no card is queued.
  const emptyKind: "nothing-tracked" | "only-stopped" | "nothing-started" | "caught-up" | null =
    !view.hasData || hasActive || hasLapsed
      ? null
      : view.totalCount === 0
        ? "nothing-tracked"
        : view.trackedCount === 0
          ? "only-stopped"
          : view.startedCount === 0
            ? "nothing-started"
            : "caught-up";

  const stopWatching = (card: UpNextCardModel): void => {
    void stop.hide(
      card.entry.showId,
      { trakt: card.entry.showId, tmdb: card.entry.tmdbId ?? undefined },
      card.entry.title,
    );
  };

  return (
    <section className="screen screen--up-next" data-testid="screen-up-next">
      <header className="screen__head">
        <h1 className="screen__title">Up Next</h1>
        <div className="screen__head-actions">
          <SyncStatusPill
            testId="sync-status"
            isFetching={view.isFetching}
            isLoading={view.isLoading}
            isError={view.isError}
            isPartial={view.isPartial}
            count={view.cards.length + view.lapsedCards.length}
            syncedAt={view.syncedAt}
          />
          <UpcomingLink />
        </div>
      </header>

      {view.isError && view.hasData && (
        <CachedRetryBanner
          testId="cached-retry"
          buttonTestId="cached-retry-button"
          message="Showing your last synced queue — Trakt couldn't be reached."
          onRetry={view.refetch}
        />
      )}

      {view.isLoading && <CardListSkeleton testId="up-next-skeleton" />}

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
          art={emptyNothingTracked}
          title="Nothing tracked yet"
          body="Follow a show and mark an episode watched — its next episode will queue up here."
        />
      )}

      {showSections && emptyKind === "only-stopped" && (
        <EmptyState
          testId="empty-only-stopped"
          art={emptyNothingTracked}
          title="All your shows are stopped"
          body="Resume one to bring it back into your queue — your watch history is kept."
          action={
            <Link to="/library" className="button button--ghost" data-testid="empty-to-library">
              Go to Library
            </Link>
          }
        />
      )}

      {showSections && emptyKind === "nothing-started" && (
        <EmptyState
          testId="empty-nothing-started"
          art={emptyNothingTracked}
          title="Nothing started yet"
          body="Mark an episode of a show you're following and it'll queue up here."
        />
      )}

      {showSections && emptyKind === "caught-up" && (
        <EmptyState
          testId="empty-all-caught-up"
          art={emptyAllCaughtUp}
          title={view.isPartial ? "Caught up on recent shows" : "You're all caught up"}
          body={
            view.isPartial
              ? "No recent shows are waiting. Older shows are still syncing — any with episodes to watch will appear here."
              : "No aired episodes are waiting. New episodes will appear here as they air."
          }
        />
      )}

      {showSections && view.newCards.length > 0 && (
        <section className="up-next-group" data-testid="up-next-new">
          <h2 className="section-heading">New</h2>
          <QueueList cards={view.newCards} leadFirst undoTarget={undoTarget} onMark={markCard} />
        </section>
      )}

      {showSections && view.continueCards.length > 0 && (
        <section className="up-next-group" data-testid="up-next-continue">
          <h2 className="section-heading">Continue</h2>
          <QueueList
            cards={view.continueCards}
            leadFirst={view.newCards.length === 0}
            listTestId="up-next-list"
            undoTarget={undoTarget}
            onMark={markCard}
          />
        </section>
      )}

      {showSections && hasLapsed && (
        <LapsedDrawer cards={view.lapsedCards} onMark={markCard} onStop={stopWatching} />
      )}

      {mark.error !== null && (
        <ErrorToast testId="mark-error" message={mark.error} onDismiss={mark.clearError} />
      )}

      {/* SECONDARY polite announcement: the PRIMARY reversal is the inline Undo on
          the just-marked card above. This toast still politely announces the mark for a
          screen reader and carries the reversal for the finished case, where the show
          leaves the queue and no card remains to host the inline Undo. */}
      {mark.undoable !== null && (
        <Snackbar
          testId="undo"
          message={
            mark.undoable.finished
              ? `You finished ${mark.undoable.title}.`
              : `Marked ${mark.undoable.title} ${mark.undoable.episodeCode} watched.`
          }
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void mark.undo()}
          onDismiss={mark.dismissUndo}
        />
      )}

      {stop.error !== null && (
        <ErrorToast testId="stop-error" message={stop.error} onDismiss={stop.clearError} />
      )}

      {stop.undoable !== null && (
        <Snackbar
          testId="stop-undo"
          message={
            stop.undoable.kind === "hide"
              ? `Stopped watching ${stop.undoable.title}.`
              : `Resumed ${stop.undoable.title}.`
          }
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void stop.undo()}
          onDismiss={stop.dismissUndo}
        />
      )}
    </section>
  );
}
