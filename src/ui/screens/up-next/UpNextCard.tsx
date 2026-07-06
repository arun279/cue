import type { TmdbImageConfig } from "@data/image-source";
import { Link } from "@tanstack/react-router";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import type { ReactElement } from "react";
import { episodeCode, watchedPercent } from "./format";
import { Poster } from "./Poster";

interface UpNextCardProps {
  readonly card: UpNextCardModel;
  readonly tmdbConfig: TmdbImageConfig | null;
  onMark(): void;
}

/**
 * One Up Next queue row: poster + title route to the Show
 * page, the amber episode code + name route to the Episode page, and the amber
 * check marks watched in place. The mark button locks while an optimistic advance
 * awaits its authoritative refetch so a provisional episode is never re-marked.
 */
export function UpNextCard({ card, tmdbConfig, onMark }: UpNextCardProps): ReactElement {
  const { entry, item } = card;
  const code = episodeCode(item.episode.season, item.episode.number);
  const percent = watchedPercent(entry.completed, entry.aired);
  const remaining = item.backlog;
  const showParams = { showId: String(entry.showId) };

  return (
    <article className="card" data-testid="up-next-card" data-show-id={entry.showId}>
      <Link to="/show/$showId" params={showParams} className="card__poster-link" tabIndex={-1}>
        <span className="poster-wrap poster-wrap--sm">
          <Poster
            title={entry.title}
            posters={entry.posters}
            tmdbConfig={tmdbConfig}
            variant="queue"
          />
          <span className="poster__bar" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
        </span>
      </Link>

      <div className="card__body">
        <Link to="/show/$showId" params={showParams} className="card__title-link">
          <h2 className="card__title">{entry.title}</h2>
        </Link>
        <Link
          to="/show/$showId/episode/$season/$episode"
          params={{
            showId: String(entry.showId),
            season: String(item.episode.season),
            episode: String(item.episode.number),
          }}
          className="card__episode"
          data-testid="up-next-card-link"
          aria-label={`${entry.title} ${code} episode details`}
        >
          <span className="card__code" data-testid="episode-code">
            {code}
          </span>
          {item.episode.title !== null && (
            <span className="card__episode-title">{item.episode.title}</span>
          )}
        </Link>
        {remaining > 0 && (
          <p className="card__backlog" data-testid="backlog">
            {remaining} to watch · {entry.completed} / {entry.aired} watched
          </p>
        )}
      </div>

      <button
        type="button"
        className="card__mark"
        data-testid="mark-watched"
        aria-label={`Mark ${entry.title} ${code} watched`}
        disabled={entry.pendingAdvance}
        aria-busy={entry.pendingAdvance}
        onClick={onMark}
      >
        <svg className="card__check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M5 13l4 4L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </article>
  );
}
