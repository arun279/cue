import { resolvePoster } from "@data/image-source";
import type { MovieEntry, MovieHeader } from "@data/trakt/movie-library";
import { Link } from "@tanstack/react-router";
import { CheckIcon } from "@ui/components/CheckIcon";
import { DetailBack } from "@ui/components/DetailBack";
import { DetailHeroSkeleton } from "@ui/components/DetailHeroSkeleton";
import { RatingControl } from "@ui/components/RatingControl";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useMovieActions } from "@ui/hooks/useMovieActions";
import { useMovieDetail } from "@ui/hooks/useMovieDetail";
import { useMovieLibrary } from "@ui/hooks/useMovieLibrary";
import { useMovieRelated } from "@ui/hooks/useMovieRelated";
import { useRate } from "@ui/hooks/useRate";
import { useWatchlistAdd } from "@ui/hooks/useWatchlistAdd";
import { DiscoverGrid } from "@ui/screens/search/DiscoverCard";
import { formatAirDate, formatWatchedDate, titleCase } from "@ui/screens/up-next/format";
import { Poster } from "@ui/screens/up-next/Poster";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { type ReactElement, useState } from "react";

const UNDO_MS = 6000;

/** Build the toggle target from the movie-library entry, or synthesize an
 * unwatched, un-watchlisted one for a movie reached directly by URL that isn't in
 * the library yet — the mark/watchlist toggles then materialize it in the cache. */
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
      posters: header.posters,
      tmdbId: header.tmdbId,
    }
  );
}

/** The full-bleed media hero: fanart backdrop with a scrim fading into the card,
 * poster inset, editorial title + year, runtime/release/genre chips, overview,
 * then the grouped control surface — the watched toggle (with its logged date),
 * the watchlist toggle, and the compact 1–10 rating. */
function MovieHero({
  header,
  entry,
  actions,
  rate,
}: {
  readonly header: MovieHeader;
  readonly entry: MovieEntry;
  readonly actions: ReturnType<typeof useMovieActions>;
  readonly rate: ReturnType<typeof useRate>;
}): ReactElement {
  const [broken, setBroken] = useState(false);
  const art = resolvePoster({ title: header.title, traktPosters: header.backdrops });
  const backdrop = art.source === "placeholder" ? null : art.url;
  const genres = header.genres.slice(0, 3);
  const watchedDate = formatWatchedDate(entry.watchedAt);
  const released = formatAirDate(header.released);

  return (
    <section className="show-hero" data-testid="movie-hero">
      {backdrop !== null && !broken && (
        <img
          className="show-hero__backdrop"
          src={backdrop}
          alt=""
          decoding="async"
          data-testid="movie-backdrop"
          onError={() => setBroken(true)}
        />
      )}
      <div className="show-hero__scrim" />
      <div className="show-hero__body">
        <span className="poster-wrap show-hero__poster">
          <Poster title={header.title} posters={header.posters} tmdbConfig={null} variant="hero" />
        </span>

        <div className="show-hero__info">
          <h1 className="show-hero__title" data-testid="movie-detail-title">
            {header.title}
            {header.year !== null && <span className="show-hero__year"> {header.year}</span>}
          </h1>

          <div className="show-hero__chips">
            {header.runtime !== null && (
              <span className="chip" data-testid="movie-runtime">
                {header.runtime} min
              </span>
            )}
            {released !== null && (
              <span className="chip" data-testid="movie-release">
                {released}
              </span>
            )}
            {genres.map((genre) => (
              <span key={genre} className="chip">
                {titleCase(genre)}
              </span>
            ))}
          </div>

          {header.overview !== null && (
            <p className="show-hero__overview" data-testid="movie-detail-overview">
              {header.overview}
            </p>
          )}
        </div>
      </div>

      <div className="show-hero__controls">
        <div className="episode-status">
          <label className="watched-toggle" data-on={entry.watched}>
            <input
              type="checkbox"
              checked={entry.watched}
              onChange={() => void actions.markWatched(entry)}
              data-testid="movie-watched-toggle"
              aria-label={`Mark ${header.title} watched`}
            />
            <CheckIcon />
            <span>{entry.watched ? "Watched" : "Mark watched"}</span>
          </label>
          {entry.watched && watchedDate !== null && (
            <span className="episode-status__date" data-testid="movie-watched-date">
              Watched {watchedDate}
            </span>
          )}
          <button
            type="button"
            className="button button--ghost"
            aria-pressed={entry.inWatchlist}
            data-testid="movie-watchlist-toggle"
            data-on={entry.inWatchlist}
            onClick={() => void actions.toggleWatchlist(entry)}
          >
            {entry.inWatchlist ? "On watchlist ✓" : "Add to watchlist"}
          </button>
        </div>

        <div className="show-hero__rating">
          <span className="rating__lead">Your rating</span>
          <RatingControl
            ids={entry.ids}
            label={entry.title}
            controller={rate}
            testId="movie-rating"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Movie detail as a media page in the screening-room language: a full-bleed
 * fanart hero (poster inset, editorial title + year, runtime/release/genre chips,
 * overview) over one grouped control surface — Mark watched (with date) /
 * watchlist toggle / 1–10 rating — all optimistic through the durable write-queue
 * with Undo. Every state is designed: hero skeleton, hard-error retry, and an
 * unwatched movie that carries no logged date.
 */
export function MovieDetail({ movieId }: { readonly movieId: number }): ReactElement {
  const detail = useMovieDetail(movieId);
  const library = useMovieLibrary();
  const actions = useMovieActions();
  const rate = useRate("movies");
  const related = useMovieRelated(movieId);
  const watchlistAdd = useWatchlistAdd();
  const header = detail.header;
  useDocumentTitle(header !== undefined ? `${header.title} · Cue` : "Movie · Cue");

  if (detail.isLoading) {
    return (
      <section className="screen screen--detail" data-testid="screen-movie-detail">
        <DetailHeroSkeleton testId="movie-skeleton" />
      </section>
    );
  }

  if (header === undefined) {
    return (
      <section className="screen screen--detail" data-testid="screen-movie-detail">
        <div className="empty" data-testid="movie-detail-error">
          <h2 className="empty__title">Couldn't load this movie</h2>
          <p className="empty__body">Check your connection and try again.</p>
          <button
            type="button"
            className="button"
            data-testid="movie-detail-error-retry"
            onClick={detail.refetch}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const entry = toEntry(header, library.entryFor(movieId));

  return (
    <section className="screen screen--detail" data-testid="screen-movie-detail">
      <DetailBack
        testId="movie-back"
        label="‹ Back"
        fallback={
          <Link
            to="/library"
            search={{ type: "movies" }}
            className="detail-back"
            data-testid="movie-back"
          >
            ‹ Library
          </Link>
        }
      />

      <MovieHero header={header} entry={entry} actions={actions} rate={rate} />

      {related.hits.length > 0 && (
        <section className="discover-rail related-rail" data-testid="movie-related">
          <h2 className="discover-rail__head">More like this</h2>
          <DiscoverGrid
            hits={related.hits}
            tmdbConfig={null}
            isAdded={watchlistAdd.isAdded}
            onAdd={(hit) => void watchlistAdd.add(hit)}
            testId="movie-related-grid"
          />
        </section>
      )}

      {watchlistAdd.addError !== null && (
        <Snackbar
          testId="movie-related-add-error"
          message={watchlistAdd.addError}
          actionLabel="Dismiss"
          onAction={watchlistAdd.clearAddError}
          onDismiss={watchlistAdd.clearAddError}
        />
      )}

      {actions.undoable !== null && (
        <Snackbar
          testId="movie-undo"
          message={`Marked ${actions.undoable.title} watched.`}
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void actions.undoMark()}
          onDismiss={actions.dismissUndo}
        />
      )}
      {actions.error !== null && (
        <Snackbar
          testId="movie-action-error"
          message={actions.error}
          actionLabel="Dismiss"
          onAction={actions.clearError}
          onDismiss={actions.clearError}
        />
      )}
      {rate.error !== null && (
        <Snackbar
          testId="movie-rating-error"
          message={rate.error}
          actionLabel="Dismiss"
          onAction={rate.clearError}
          onDismiss={rate.clearError}
        />
      )}
    </section>
  );
}
