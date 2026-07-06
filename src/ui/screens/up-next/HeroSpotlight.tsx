import { resolvePoster, type TmdbImageConfig } from "@data/image-source";
import { Link } from "@tanstack/react-router";
import { CheckIcon } from "@ui/components/CheckIcon";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import { type ReactElement, useState } from "react";
import { episodeCode, formatAirDate, titleCase, watchedPercent } from "./format";
import { Poster } from "./Poster";

interface HeroSpotlightProps {
  readonly card: UpNextCardModel;
  readonly tmdbConfig: TmdbImageConfig | null;
  onMark(): void;
}

/**
 * The cinematic hero for the most-recently-watched show at the top of the queue
 * backdrop still + poster inset + editorial title, broadcast chips, the
 * amber SxxExx badge, air/runtime line, amber progress, and the one-tap Mark
 * watched ritual. Poster/title and "Show details" route to the Show page; the
 * episode line routes to the Episode page.
 */
export function HeroSpotlight({ card, tmdbConfig, onMark }: HeroSpotlightProps): ReactElement {
  const { entry, item } = card;
  const [bdBroken, setBdBroken] = useState(false);
  const code = episodeCode(item.episode.season, item.episode.number);
  const percent = watchedPercent(entry.completed, entry.aired);
  const airDate = formatAirDate(item.episode.firstAired);
  const genres = (entry.genres ?? []).slice(0, 2);

  // The backdrop reuses the poster resolver purely to https-normalize the first
  // non-empty Trakt fanart URL; a load failure falls back to the solid surface.
  const backdrop = resolvePoster({ title: entry.title, traktPosters: entry.backdrops ?? null });
  const backdropUrl = !bdBroken && backdrop.source !== "placeholder" ? backdrop.url : null;

  const showParams = { showId: String(entry.showId) };
  const metaParts = [
    entry.runtime !== null ? `${entry.runtime} min` : null,
    airDate !== null ? `aired ${airDate}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <section className="spotlight" data-testid="up-next-hero" data-show-id={entry.showId}>
      {backdropUrl !== null && (
        <img
          className="spotlight__backdrop"
          src={backdropUrl}
          alt=""
          decoding="async"
          onError={() => setBdBroken(true)}
        />
      )}
      <div className="spotlight__scrim" />
      <div className="spotlight__inner">
        <Link
          to="/show/$showId"
          params={showParams}
          className="spotlight__poster-link"
          tabIndex={-1}
        >
          <span className="poster-wrap">
            <Poster
              title={entry.title}
              posters={entry.posters}
              tmdbConfig={tmdbConfig}
              variant="hero"
            />
            <span className="poster__bar" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </span>
          </span>
        </Link>

        <div className="spotlight__body">
          <p className="spotlight__eyebrow">Continue watching</p>
          <Link to="/show/$showId" params={showParams} className="spotlight__title-link">
            <h2 className="spotlight__title">{entry.title}</h2>
          </Link>

          {(entry.network !== null || genres.length > 0) && (
            <div className="spotlight__chips">
              {entry.network !== null && <span className="chip">{entry.network}</span>}
              {genres.map((genre) => (
                <span key={genre} className="chip">
                  {titleCase(genre)}
                </span>
              ))}
            </div>
          )}

          <Link
            to="/show/$showId/episode/$season/$episode"
            params={{
              showId: String(entry.showId),
              season: String(item.episode.season),
              episode: String(item.episode.number),
            }}
            className="spotlight__epline"
            data-testid="up-next-card-link"
            aria-label={`${entry.title} ${code} episode details`}
          >
            <span className="ep-badge" data-testid="episode-code">
              {code}
            </span>
            {item.episode.title !== null && (
              <span className="spotlight__epname">{item.episode.title}</span>
            )}
          </Link>

          {metaParts.length > 0 && <p className="spotlight__meta">{metaParts.join(" · ")}</p>}

          <div className="spotlight__progress">
            <span className="progress" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </span>
            <span className="progress-ratio">
              {entry.completed} / {entry.aired} watched
            </span>
          </div>

          <div className="spotlight__actions">
            <button
              type="button"
              className="button"
              data-testid="mark-watched"
              aria-label={`Mark ${entry.title} ${code} watched`}
              disabled={entry.pendingAdvance}
              aria-busy={entry.pendingAdvance}
              onClick={onMark}
            >
              <CheckIcon />
              Mark watched
            </button>
            <Link
              to="/show/$showId"
              params={showParams}
              className="button button--ghost"
              data-testid="up-next-hero-details"
            >
              Show details
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
