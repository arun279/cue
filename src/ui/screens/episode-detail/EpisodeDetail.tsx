import { resolvePoster } from "@data/image-source";
import type { EpisodeDetail as EpisodeDetailModel, EpisodeNav } from "@data/trakt/episode-detail";
import type { ShowHeader } from "@data/trakt/show-detail";
import { Link } from "@tanstack/react-router";
import { artGradient } from "@ui/components/artGradient";
import { CheckIcon } from "@ui/components/CheckIcon";
import { DetailBack } from "@ui/components/DetailBack";
import { DetailHeroSkeleton } from "@ui/components/DetailHeroSkeleton";
import { ErrorRetry, ErrorToast } from "@ui/components/ErrorStates";
import { RatingControl } from "@ui/components/RatingControl";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useEpisode } from "@ui/hooks/useEpisode";
import { useRate } from "@ui/hooks/useRate";
import { useShowDetail } from "@ui/hooks/useShowDetail";
import { useToggleEpisodeWatched } from "@ui/hooks/useToggleEpisodeWatched";
import { episodeCode, formatAirDate, formatWatchedDate } from "@ui/screens/up-next/format";
import { Poster } from "@ui/screens/up-next/Poster";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { type ReactElement, useState } from "react";

/** The cinematic 16:9 still, cropped into the hero's fixed-height backdrop band
 * (not a full-width banner) with a scrim fading into the card. A
 * missing or broken image degrades to the deterministic gradient plate so the
 * header never tears into raw whitespace. */
function HeroBackdrop({ episode }: { episode: EpisodeDetailModel }): ReactElement {
  const [broken, setBroken] = useState(false);
  const seed = episode.title ?? episodeCode(episode.season, episode.number);
  const still = resolvePoster({ title: seed, traktPosters: episode.stills });

  if (still.source === "placeholder" || broken) {
    return (
      <div
        className="show-hero__backdrop"
        data-testid="episode-still-text"
        style={{ background: artGradient(seed) }}
      />
    );
  }
  return (
    <img
      className="show-hero__backdrop"
      src={still.url}
      alt=""
      decoding="async"
      data-testid="episode-still"
      onError={() => setBroken(true)}
    />
  );
}

/** Cinematic still + show poster inset + broadcast metadata + editorial title,
 * with a grouped control surface (watched toggle, logged date, rating) below —
 * the same media-hero composition as the Show page. */
function EpisodeHero({
  episode,
  showHeader,
  watchedToggle,
  rate,
}: {
  readonly episode: EpisodeDetailModel;
  readonly showHeader: ShowHeader | undefined;
  readonly watchedToggle: ReturnType<typeof useToggleEpisodeWatched>;
  readonly rate: ReturnType<typeof useRate>;
}): ReactElement {
  const code = episodeCode(episode.season, episode.number);
  const air = formatAirDate(episode.firstAired);
  const watchedDate = formatWatchedDate(episode.watchedAt);
  const watchedLabel = episode.watched
    ? "Watched"
    : episode.aired
      ? "Mark watched"
      : "Not aired yet";
  const showParams = { showId: String(episode.showId) };

  return (
    <article className="show-hero episode-hero" data-testid="episode-hero">
      <HeroBackdrop episode={episode} />
      <div className="show-hero__scrim" />
      <div className="show-hero__body">
        {showHeader !== undefined && (
          <Link
            to="/show/$showId"
            params={showParams}
            className="poster-wrap show-hero__poster episode-hero__poster"
            aria-label={`Go to ${showHeader.title}`}
            data-testid="episode-show-poster"
          >
            <Poster
              title={showHeader.title}
              posters={showHeader.posters}
              tmdbConfig={null}
              variant="hero"
            />
          </Link>
        )}

        <div className="show-hero__info">
          <p className="episode-hero__eyebrow" data-testid="episode-show-context">
            {showHeader !== undefined && (
              <>
                <Link to="/show/$showId" params={showParams} className="episode-hero__show">
                  {showHeader.title}
                </Link>
                <span aria-hidden="true"> · </span>
              </>
            )}
            Season {episode.season}
          </p>

          <div className="show-hero__chips">
            <span className="ep-badge" data-testid="episode-detail-code">
              {code}
            </span>
            {air !== null && (
              <span className="chip" data-testid="episode-air-date">
                Aired {air}
              </span>
            )}
            {episode.runtime !== null && (
              <span className="chip" data-testid="episode-runtime">
                {episode.runtime} min
              </span>
            )}
          </div>

          <h1 className="show-hero__title episode-hero__title" data-testid="episode-detail-title">
            {episode.title ?? "Untitled episode"}
          </h1>

          {episode.overview !== null ? (
            <p className="show-hero__overview" data-testid="episode-detail-overview">
              {episode.overview}
            </p>
          ) : (
            <p
              className="show-hero__overview episode-hero__overview--empty"
              data-testid="episode-detail-empty"
            >
              Details not available yet.
            </p>
          )}
        </div>
      </div>

      <div className="show-hero__controls episode-hero__controls">
        <div className="episode-status">
          <label
            className="watched-toggle"
            data-on={episode.watched}
            data-disabled={!episode.aired}
          >
            <input
              type="checkbox"
              checked={episode.watched}
              disabled={!episode.aired}
              onChange={() => void watchedToggle.toggle(episode)}
              data-testid="episode-watched-toggle"
              aria-label={`Mark ${code} watched`}
            />
            <CheckIcon />
            <span>{watchedLabel}</span>
          </label>
          {episode.watched && watchedDate !== null && (
            <span className="episode-status__date" data-testid="episode-watched-date">
              Watched {watchedDate}
            </span>
          )}
        </div>

        <div className="show-hero__rating">
          <span className="rating__lead">Your rating</span>
          <RatingControl
            ids={episode.ids}
            label={episode.title ?? "This episode"}
            controller={rate}
            testId="episode-rating"
          />
        </div>
      </div>
    </article>
  );
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
  const dir = direction === "prev" ? "‹ Previous" : "Next ›";
  const cls = `episode-nav__link episode-nav__link--${direction}`;
  if (target === null) {
    return (
      <span className={`${cls} episode-nav__link--disabled`} data-testid={`episode-${direction}`}>
        <span className="episode-nav__dir">{dir}</span>
        <span className="episode-nav__code">
          No {direction === "prev" ? "earlier" : "later"} episode
        </span>
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
      className={cls}
      data-testid={`episode-${direction}`}
      aria-label={`${direction === "prev" ? "Previous" : "Next"} episode: ${episodeCode(target.season, target.number)}`}
    >
      <span className="episode-nav__dir">{dir}</span>
      <span className="episode-nav__code">{episodeCode(target.season, target.number)}</span>
    </Link>
  );
}

/**
 * Episode detail in the screening-room language: the same
 * media-hero composition as the Show page — a cinematic still cropped into a
 * fixed-height backdrop band, the show poster inset (poster-first, links back to
 * the show), broadcast metadata, the editorial title and overview, then one
 * grouped control surface carrying the watched toggle (with its logged date and
 * all-plays unwatch semantics, optimistic writes) and the compact RatingControl.
 * Enlarged prev/next paddles sit directly beneath. Every state is designed —
 * skeleton, hard-error retry, and the "details not available yet" partial (the
 * toggle still works).
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
  const show = useShowDetail(showId);
  const watchedToggle = useToggleEpisodeWatched();
  const rate = useRate("episodes");
  const episode = view.episode;
  const code = episodeCode(season, number);
  useDocumentTitle(
    show.header !== undefined ? `${show.header.title} · ${code} · Cue` : `${code} · Cue`,
  );

  if (view.isLoading) {
    return (
      <section className="screen screen--detail" data-testid="screen-episode-detail">
        <DetailHeroSkeleton testId="episode-skeleton" />
      </section>
    );
  }

  if (episode === undefined) {
    return (
      <section className="screen screen--detail" data-testid="screen-episode-detail">
        <ErrorRetry
          title="Couldn't load this episode"
          testId="episode-error"
          buttonTestId="episode-error-retry"
          onRetry={view.refetch}
        />
      </section>
    );
  }

  const backLabel = show.header?.title ?? "Show";

  return (
    <section className="screen screen--detail" data-testid="screen-episode-detail">
      <DetailBack
        testId="episode-back"
        label="‹ Back"
        fallback={
          <Link
            to="/show/$showId"
            params={{ showId: String(showId) }}
            className="detail-back"
            data-testid="episode-back"
          >
            ‹ {backLabel}
          </Link>
        }
      />

      <EpisodeHero
        episode={episode}
        showHeader={show.header}
        watchedToggle={watchedToggle}
        rate={rate}
      />

      <nav className="episode-nav" aria-label="Episode navigation">
        <NavLink showId={showId} target={episode.prev} direction="prev" />
        <NavLink showId={showId} target={episode.next} direction="next" />
      </nav>

      {watchedToggle.error !== null && (
        <ErrorToast
          testId="episode-watched-error"
          message={watchedToggle.error}
          onDismiss={watchedToggle.clearError}
        />
      )}
      {watchedToggle.error === null && watchedToggle.notice !== null && (
        <Snackbar
          testId="episode-watched-notice"
          message={watchedToggle.notice}
          actionLabel="Dismiss"
          onAction={watchedToggle.dismissNotice}
          onDismiss={watchedToggle.dismissNotice}
        />
      )}
      {rate.error !== null && (
        <ErrorToast
          testId="episode-rating-error"
          message={rate.error}
          onDismiss={rate.clearError}
        />
      )}
    </section>
  );
}
