import type { MovieEntry, MovieHeader } from "@data/trakt/movie-library";
import { Link, useNavigate } from "@tanstack/react-router";
import { ActionSheet, type ActionSheetRow } from "@ui/components/ActionSheet";
import { Badge } from "@ui/components/Badge";
import { CheckControl } from "@ui/components/CheckControl";
import { DetailHeroSkeleton } from "@ui/components/DetailHeroSkeleton";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { formatWatchedDate, middleTruncate, titleCase } from "@ui/format";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useMovieActions } from "@ui/hooks/useMovieActions";
import { useMovieDetail } from "@ui/hooks/useMovieDetail";
import { useMovieLibrary } from "@ui/hooks/useMovieLibrary";
import { useMovieRelated } from "@ui/hooks/useMovieRelated";
import { usePrefs } from "@ui/prefs/prefs-store";
import { BackDisc, DetailHero } from "@ui/screens/show-detail/DetailChrome";
import { metaLine, openExternal, traktMovieUrl } from "@ui/screens/show-detail/detail-logic";
import { Poster } from "@ui/screens/up-next/Poster";
import { ExternalLink } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

/** Build the toggle target from the movie-library entry, or synthesize an
 * unwatched, un-watchlisted one for a movie reached directly by URL that isn't in
 * the library yet: the mark/watchlist toggles then materialize it in the cache. */
function toEntry(header: MovieHeader, existing: MovieEntry | undefined): MovieEntry {
  return (
    existing ?? {
      movieId: header.movieId,
      ids: header.ids,
      title: header.title,
      year: header.year,
      watched: false,
      watchedAt: null,
      inWatchlist: false,
      listedAt: null,
      posters: header.posters,
      tmdbId: header.tmdbId,
    }
  );
}

/**
 * Movie detail (§3.3.5): hero, one 64px mark row whose 56px check is a durable,
 * rewatch-safe toggle (a settled play is removed by its exact history id; a
 * multi-play movie is refused and routed to History), the clamped overview, and
 * a related grid. Watchlist and the Trakt hand-off live in the overflow disc.
 */
function MovieDetailContent({ movieId }: { readonly movieId: number }): ReactElement {
  const detail = useMovieDetail(movieId);
  const library = useMovieLibrary();
  const actions = useMovieActions();
  const related = useMovieRelated(movieId);
  const navigate = useNavigate();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const header = detail.header;
  useDocumentTitle(header !== undefined ? `${header.title} · Cue` : "Movie · Cue");

  const entry = header === undefined ? undefined : toEntry(header, library.entryFor(movieId));
  // Snackbar Undo closures must see the post-action entry/controller, not the
  // render they were created in.
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const markSeq = actions.undoable?.seq;
  const markTitle = actions.undoable?.title;
  const { undoMark } = actions;
  useEffect(() => {
    if (markSeq === undefined || markTitle === undefined) return;
    showSnack({
      message: `${middleTruncate(markTitle)} marked`,
      actions: [
        {
          label: "Undo",
          testId: "snackbar-undo",
          onPress: () => {
            dismissSnack();
            void undoMark();
          },
        },
      ],
    });
  }, [markSeq, markTitle, undoMark]);

  const removedSeq = actions.removed?.seq;
  const removedCanUndo = actions.removed?.canUndo;
  const { undoRemove } = actions;
  useEffect(() => {
    if (removedSeq === undefined) return;
    showSnack({
      message: "Removed play",
      actions:
        removedCanUndo === true
          ? [
              {
                label: "Undo",
                testId: "snackbar-undo",
                onPress: () => {
                  dismissSnack();
                  void undoRemove();
                },
              },
            ]
          : [],
    });
  }, [removedSeq, removedCanUndo, undoRemove]);

  const { notice, dismissNotice, error, clearError } = actions;
  useEffect(() => {
    if (notice === null) return;
    showSnack({
      message: notice,
      actions: [
        {
          label: "Open history",
          onPress: () => {
            dismissSnack();
            void navigate({ to: "/history", search: { type: "movies" } });
          },
        },
      ],
    });
    dismissNotice();
  }, [notice, dismissNotice, navigate]);
  useEffect(() => {
    if (error === null) return;
    showSnack({ message: error, actions: [{ label: "Dismiss", onPress: dismissSnack }] });
    clearError();
  }, [error, clearError]);

  if (detail.isLoading) {
    return (
      <section className="screen-detail" data-testid="screen-movie-detail">
        <DetailHeroSkeleton testId="movie-skeleton" rows={1} />
      </section>
    );
  }

  if (header === undefined || entry === undefined) {
    return (
      <section className="screen-detail" data-testid="screen-movie-detail">
        <BackDisc testId="movie-back" fallbackSearch={{ type: "movies" }} />
        <ErrorRetry
          title="Couldn't load this movie"
          testId="movie-detail-error"
          buttonTestId="movie-detail-error-retry"
          onRetry={detail.refetch}
        />
      </section>
    );
  }

  const watchedDate = formatWatchedDate(entry.watchedAt);
  const relatedMovies = related.hits.filter((hit) => hit.type === "movie").slice(0, 6);
  const overflowRows: ActionSheetRow[] = [
    {
      label: entry.inWatchlist ? "Remove from Watchlist" : "Add to Watchlist",
      testId: "overflow-watchlist",
      onPress: () => {
        const adding = !entry.inWatchlist;
        void actions.toggleWatchlist(entry);
        showSnack({
          message: `${middleTruncate(entry.title)} ${adding ? "added to" : "removed from"} Watchlist`,
          actions: [
            {
              label: "Undo",
              testId: "snackbar-undo",
              onPress: () => {
                dismissSnack();
                const current = entryRef.current;
                if (current !== undefined) void actionsRef.current.toggleWatchlist(current);
              },
            },
          ],
        });
      },
    },
    {
      label: "Open on Trakt",
      icon: <ExternalLink aria-hidden="true" />,
      testId: "overflow-trakt",
      onPress: () => openExternal(traktMovieUrl(header.ids)),
    },
  ];

  return (
    <section className="screen-detail" data-testid="screen-movie-detail">
      <DetailHero
        header={header}
        meta={metaLine([
          header.year === null ? null : String(header.year),
          header.runtime === null ? null : `${header.runtime} min`,
          ...header.genres.slice(0, 2).map(titleCase),
        ])}
        testIds={{
          hero: "movie-hero",
          backdrop: "movie-backdrop",
          title: "movie-detail-title",
          back: "movie-back",
          overflow: "movie-overflow",
        }}
        onOverflow={() => setOverflowOpen(true)}
        backFallbackSearch={{ type: "movies" }}
      />

      <div className="mark-row" data-testid="movie-mark-row">
        <span className="mark-row__text">
          <span className="mark-row__status">
            {entry.watched
              ? watchedDate === null
                ? "Watched"
                : `Watched ${watchedDate}`
              : "Not watched yet"}
          </span>
          {entry.watched && <span className="mark-row__hint">tap the check to remove</span>}
        </span>
        <CheckControl
          size={56}
          state={entry.watched ? "watched" : "unwatched"}
          label={entry.watched ? "Watched — tap to remove" : `Mark ${entry.title} watched`}
          testId="movie-check"
          onPress={() => void actions.markWatched(entry)}
        />
      </div>

      {header.overview !== null && (
        <section className="detail-about">
          <div className="detail-about__overview">
            <p className="clamp-4" data-expanded={expanded} data-testid="movie-detail-overview">
              {header.overview}
            </p>
            {!expanded && (
              <button type="button" className="text-more" onClick={() => setExpanded(true)}>
                More
              </button>
            )}
          </div>
        </section>
      )}

      {relatedMovies.length > 0 && (
        <section className="detail-related" data-testid="movie-related">
          <h2 className="detail-related__head">More like this</h2>
          <div className="poster-tile-grid">
            {relatedMovies.map((hit) => (
              <Link
                key={hit.key}
                to="/movie/$movieId"
                params={{ movieId: String(hit.traktId) }}
                className="poster-tile"
                data-testid="movie-related-tile"
              >
                <span className="poster-tile__art">
                  <Poster title={hit.title} posters={hit.posters} variant="s115" />
                  {hit.year !== null && (
                    <span className="poster-tile__badge">
                      <Badge variant="year">{hit.year}</Badge>
                    </span>
                  )}
                </span>
                <span className="poster-tile__title">{hit.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ActionSheet
        open={overflowOpen}
        onOpenChange={setOverflowOpen}
        title={header.title}
        rows={overflowRows}
      />
    </section>
  );
}

/**
 * Movie-detail route gate. When Movies are turned off, a stale link or
 * bookmark lands on a quiet notice with a way back on, and, crucially, the movie
 * read hooks live in `MovieDetailContent`, which only mounts when Movies are on, so
 * a hidden medium issues no movie reads (never a detail/library/related fetch for a
 * disabled section). With Movies on, the full detail page renders unchanged.
 */
export function MovieDetail({ movieId }: { readonly movieId: number }): ReactElement {
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  if (!moviesEnabled) {
    return (
      <section className="screen-detail" data-testid="screen-movie-detail">
        <BackDisc testId="movie-back" />
        <EmptyState
          testId="movies-off"
          headline="Movies are turned off"
          body="Turn Movies back on in Settings to browse and track films."
        >
          <Link className="button" to="/settings" data-testid="movies-off-settings">
            Open Settings
          </Link>
        </EmptyState>
      </section>
    );
  }
  return <MovieDetailContent movieId={movieId} />;
}
