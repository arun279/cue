import { useMarkWatched } from "@ui/hooks/useMarkWatched";
import { useUpNext } from "@ui/hooks/useUpNext";
import type { ReactElement } from "react";
import { Snackbar } from "./Snackbar";
import { UpNextCard } from "./UpNextCard";

const SKELETON_ROWS = [0, 1, 2, 3];
const UNDO_MS = 6000;

function Skeleton(): ReactElement {
  return (
    <ul className="card-list" aria-hidden="true" data-testid="up-next-skeleton">
      {SKELETON_ROWS.map((row) => (
        <li key={row} className="card card--skeleton">
          <div className="poster poster--skeleton" />
          <div className="card__body">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--sub" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  testId,
  title,
  body,
}: {
  testId: string;
  title: string;
  body: string;
}): ReactElement {
  return (
    <div className="empty" data-testid={testId}>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{body}</p>
    </div>
  );
}

/**
 * Up Next — the home screen and heart of Cue. Every state is
 * designed: skeleton while the first load runs, a hard-error retry when nothing
 * is cached, a cached-retry banner when a refetch fails over cached data, the
 * two distinct empty states ("nothing tracked" vs "all caught up"), and the
 * queue itself with the optimistic mark-watched action + Undo.
 */
export function UpNext(): ReactElement {
  const view = useUpNext();
  const mark = useMarkWatched();

  const showQueue = view.cards.length > 0;
  const nothingTracked = view.hasData && view.trackedCount === 0;

  return (
    <section className="screen screen--up-next" data-testid="screen-up-next">
      <header className="screen__head">
        <h1 className="screen__title">Up Next</h1>
        <p
          className="status-pill"
          role="status"
          data-testid="sync-status"
          data-count={view.cards.length}
          data-state={view.isFetching ? "syncing" : view.isError ? "offline" : "synced"}
        >
          {view.isFetching ? "Syncing…" : view.isError ? "Offline" : "Synced"}
        </p>
      </header>

      {view.isError && view.hasData && (
        <div className="banner banner--warn" role="alert" data-testid="cached-retry">
          <span>Showing your last synced queue — Trakt couldn't be reached.</span>
          <button
            type="button"
            className="button button--ghost button--sm"
            data-testid="cached-retry-button"
            onClick={view.refetch}
          >
            Retry
          </button>
        </div>
      )}

      {view.isLoading && <Skeleton />}

      {!view.isLoading && view.isError && !view.hasData && (
        <div className="empty" data-testid="up-next-error">
          <h2 className="empty__title">Couldn't load your queue</h2>
          <p className="empty__body">Check your connection and try again.</p>
          <button
            type="button"
            className="button"
            data-testid="up-next-error-retry"
            onClick={view.refetch}
          >
            Retry
          </button>
        </div>
      )}

      {!view.isLoading && view.hasData && !showQueue && nothingTracked && (
        <EmptyState
          testId="empty-nothing-tracked"
          title="Nothing tracked yet"
          body="Follow a show and mark an episode watched — its next episode will queue up here."
        />
      )}

      {!view.isLoading && view.hasData && !showQueue && !nothingTracked && (
        <EmptyState
          testId="empty-all-caught-up"
          title="You're all caught up"
          body="No aired episodes are waiting. New episodes will appear here as they air."
        />
      )}

      {showQueue && (
        <ul className="card-list" data-testid="up-next-list">
          {view.cards.map((card) => (
            <li key={card.entry.showId}>
              <UpNextCard
                card={card}
                tmdbConfig={view.tmdbConfig}
                onMark={() => void mark.markWatched(card.entry)}
              />
            </li>
          ))}
        </ul>
      )}

      {mark.error !== null && (
        <Snackbar
          testId="mark-error"
          message={mark.error}
          actionLabel="Dismiss"
          onAction={mark.clearError}
          onDismiss={mark.clearError}
        />
      )}

      {mark.undoable !== null && (
        <Snackbar
          testId="undo"
          message={`Marked ${mark.undoable.title} ${mark.undoable.episodeCode} watched.`}
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void mark.undo()}
          onDismiss={mark.dismissUndo}
        />
      )}
    </section>
  );
}
