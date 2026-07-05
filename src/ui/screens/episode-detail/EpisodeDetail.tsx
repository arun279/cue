import { resolvePoster } from "@data/image-source";
import type { EpisodeDetail as EpisodeDetailModel, EpisodeNav } from "@data/trakt/episode-detail";
import { Link } from "@tanstack/react-router";
import { RatingControl } from "@ui/components/RatingControl";
import { useEpisode } from "@ui/hooks/useEpisode";
import { useRate } from "@ui/hooks/useRate";
import { useToggleEpisodeWatched } from "@ui/hooks/useToggleEpisodeWatched";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import type { ReactElement } from "react";

function code(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function Still({ episode }: { episode: EpisodeDetailModel }): ReactElement {
  const still = resolvePoster({
    title: episode.title ?? code(episode.season, episode.number),
    traktPosters: episode.stills,
  });
  if (still.source === "placeholder") {
    return (
      <div className="still still--text" data-testid="episode-still-text">
        <span className="still__code" aria-hidden="true">
          {code(episode.season, episode.number)}
        </span>
      </div>
    );
  }
  return <img className="still" src={still.url} alt="" data-testid="episode-still" />;
}

function NavLink({
  showId,
  target,
  direction,
}: {
  showId: number;
  target: EpisodeNav | null;
  direction: "prev" | "next";
}): ReactElement {
  const label = direction === "prev" ? "Previous episode" : "Next episode";
  if (target === null) {
    return (
      <span
        className="episode-nav__link episode-nav__link--disabled"
        data-testid={`episode-${direction}`}
        aria-disabled="true"
      >
        {direction === "prev" ? "← " : ""}
        {label}
        {direction === "next" ? " →" : ""}
      </span>
    );
  }
  return (
    <Link
      to="/show/$showId/episode/$season/$episode"
      params={{
        showId: String(showId),
        season: String(target.season),
        episode: String(target.number),
      }}
      className="episode-nav__link"
      data-testid={`episode-${direction}`}
      aria-label={`${label}: ${code(target.season, target.number)}`}
    >
      {direction === "prev" ? "← " : ""}
      {code(target.season, target.number)}
      {direction === "next" ? " →" : ""}
    </Link>
  );
}

/**
 * Episode detail: the still (via the image resolver, text fallback),
 * SxEy + title + air date + runtime + overview, a watched toggle that surfaces the
 * watched date, a 1–10 rating, and prev/next navigation within the show. Every
 * state is designed — skeleton, hard-error retry, the "details not available yet"
 * partial (the toggle still works), and success.
 */
export function EpisodeDetail({
  showId,
  season,
  number,
}: {
  showId: number;
  season: number;
  number: number;
}): ReactElement {
  const view = useEpisode(showId, season, number);
  const watchedToggle = useToggleEpisodeWatched();
  const rate = useRate("episodes");
  const episode = view.episode;

  if (view.isLoading) {
    return (
      <section className="screen screen--detail" data-testid="screen-episode-detail">
        <div className="episode-detail episode-detail--skeleton" data-testid="episode-skeleton">
          <div className="still still--skeleton" />
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line skeleton-line--sub" />
        </div>
      </section>
    );
  }

  if (episode === undefined) {
    return (
      <section className="screen screen--detail" data-testid="screen-episode-detail">
        <div className="empty" data-testid="episode-error">
          <h2 className="empty__title">Couldn't load this episode</h2>
          <p className="empty__body">Check your connection and try again.</p>
          <button
            type="button"
            className="button"
            data-testid="episode-error-retry"
            onClick={view.refetch}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const air = formatDate(episode.firstAired);
  const watchedDate = formatDate(episode.watchedAt);

  return (
    <section className="screen screen--detail" data-testid="screen-episode-detail">
      <Link
        to="/show/$showId"
        params={{ showId: String(showId) }}
        className="detail-back"
        data-testid="episode-back"
      >
        ← Show
      </Link>

      <article className="episode-detail">
        <Still episode={episode} />
        <div className="episode-detail__body">
          <p className="episode-detail__code" data-testid="episode-detail-code">
            {code(episode.season, episode.number)}
          </p>
          <h1 className="episode-detail__title" data-testid="episode-detail-title">
            {episode.title ?? "Untitled episode"}
          </h1>
          <p className="episode-detail__meta">
            {air !== null && <span data-testid="episode-air-date">Aired {air}</span>}
            {episode.runtime !== null && (
              <span data-testid="episode-runtime">{episode.runtime} min</span>
            )}
          </p>

          {episode.overview !== null ? (
            <p className="episode-detail__overview" data-testid="episode-detail-overview">
              {episode.overview}
            </p>
          ) : (
            <p
              className="episode-detail__overview episode-detail__overview--empty"
              data-testid="episode-detail-empty"
            >
              Details not available yet.
            </p>
          )}

          <div className="episode-detail__watched">
            <label className="episode-detail__toggle">
              <input
                type="checkbox"
                checked={episode.watched}
                disabled={!episode.aired}
                onChange={() => void watchedToggle.toggle(episode)}
                data-testid="episode-watched-toggle"
                aria-label={`Mark ${code(episode.season, episode.number)} watched`}
              />
              <span>
                {episode.watched ? "Watched" : episode.aired ? "Mark watched" : "Not aired yet"}
              </span>
            </label>
            {episode.watched && watchedDate !== null && (
              <span className="episode-detail__watched-date" data-testid="episode-watched-date">
                Watched {watchedDate}
              </span>
            )}
          </div>

          <div className="episode-detail__rating">
            <h2 className="episode-detail__section-title">Your rating</h2>
            <RatingControl
              ids={episode.ids}
              label={episode.title ?? "This episode"}
              controller={rate}
              testId="episode-rating"
            />
          </div>
        </div>
      </article>

      <nav className="episode-nav" aria-label="Episode navigation">
        <NavLink showId={showId} target={episode.prev} direction="prev" />
        <NavLink showId={showId} target={episode.next} direction="next" />
      </nav>

      {watchedToggle.error !== null && (
        <Snackbar
          testId="episode-watched-error"
          message={watchedToggle.error}
          actionLabel="Dismiss"
          onAction={watchedToggle.clearError}
          onDismiss={watchedToggle.clearError}
        />
      )}
      {rate.error !== null && (
        <Snackbar
          testId="episode-rating-error"
          message={rate.error}
          actionLabel="Dismiss"
          onAction={rate.clearError}
          onDismiss={rate.clearError}
        />
      )}
    </section>
  );
}
