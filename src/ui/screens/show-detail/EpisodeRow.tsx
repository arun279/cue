import type { EpisodeView } from "@data/trakt/show-detail";
import { Link } from "@tanstack/react-router";
import { episodeCode, formatWatchedDate } from "@ui/format";
import type { ReactElement } from "react";
import { Still } from "./Still";

interface EpisodeRowProps {
  readonly showId: number;
  readonly episode: EpisodeView;
  readonly isNext: boolean;
  onToggle(): void;
  onMarkUpToHere(): void;
}

function airLabel(firstAired: string | null): string {
  if (firstAired === null) return "TBA";
  const date = new Date(firstAired);
  return Number.isNaN(date.getTime()) ? "TBA" : date.toLocaleDateString();
}

const Check = (): ReactElement => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M5 13l4 4L19 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * One episode as a still card in the season shelf: a 16:9 thumbnail carrying the
 * watched toggle as a check badge: GREEN once watched (done), amber only while
 * hovering an unwatched still as an action preview (disabled + locked while unaired so
 * an unaired episode can never be marked). The SxEy code + title link into Episode
 * detail, and a "Mark up to here" catch-up affordance sits on aired episodes. The
 * currently-next episode gets an amber code and marker.
 */
export function EpisodeRow({
  showId,
  episode,
  isNext,
  onToggle,
  onMarkUpToHere,
}: EpisodeRowProps): ReactElement {
  const code = episodeCode(episode.season, episode.number);
  const label = episode.title ?? "Untitled";
  const watchedDate = episode.watched ? formatWatchedDate(episode.watchedAt) : null;
  const params = {
    showId: String(showId),
    season: String(episode.season),
    episode: String(episode.number),
  };
  return (
    <li
      className="ep-still"
      data-testid="episode-row"
      data-aired={episode.aired}
      data-next={isNext}
    >
      <div className="ep-still__thumb">
        <Link
          to="/show/$showId/episode/$season/$episode"
          params={params}
          className="ep-still__thumb-link"
          tabIndex={-1}
          aria-hidden="true"
        >
          <Still title={label} stills={episode.stills} />
        </Link>
        <label className="ep-still__toggle" data-watched={episode.watched}>
          <input
            type="checkbox"
            className="ep-still__box"
            checked={episode.watched}
            disabled={!episode.aired}
            onChange={onToggle}
            data-testid="episode-toggle"
            aria-label={`Mark ${code}${episode.title === null ? "" : ` ${episode.title}`} watched`}
          />
          <span className="ep-still__badge" aria-hidden="true">
            <Check />
          </span>
        </label>
        {episode.aired && (
          <button
            type="button"
            className="ep-still__catchup"
            data-testid="mark-up-to-here"
            onClick={onMarkUpToHere}
          >
            Mark up to here
          </button>
        )}
      </div>
      <Link
        to="/show/$showId/episode/$season/$episode"
        params={params}
        className="ep-still__link"
        data-testid="episode-link"
      >
        <span className="ep-still__code">
          {code}
          {isNext && <span className="ep-still__next"> · Next</span>}
        </span>
        <span className="ep-still__title">{label}</span>
      </Link>
      {!episode.aired && (
        <span className="ep-still__unaired" data-testid="episode-unaired">
          Airs {airLabel(episode.firstAired)}
        </span>
      )}
      {watchedDate !== null && (
        <span className="ep-still__watched" data-testid="episode-watched-date">
          Watched {watchedDate}
        </span>
      )}
    </li>
  );
}
