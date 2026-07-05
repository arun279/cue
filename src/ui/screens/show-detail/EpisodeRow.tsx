import type { EpisodeView } from "@data/trakt/show-detail";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

interface EpisodeRowProps {
  readonly showId: number;
  readonly episode: EpisodeView;
  onToggle(): void;
  onMarkUpToHere(): void;
}

function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

function airLabel(firstAired: string | null): string {
  if (firstAired === null) return "Air date TBA";
  const date = new Date(firstAired);
  return Number.isNaN(date.getTime()) ? "Air date TBA" : date.toLocaleDateString();
}

/**
 * One episode row: a watched checkbox (disabled + labelled "airs on…" while
 * unaired, so an unaired episode can never be marked), a link into Episode detail
 * (the SxEy code + title), and a "Mark up to here" catch-up affordance on aired
 * episodes.
 */
export function EpisodeRow({
  showId,
  episode,
  onToggle,
  onMarkUpToHere,
}: EpisodeRowProps): ReactElement {
  const code = episodeCode(episode.season, episode.number);
  return (
    <li className="episode" data-testid="episode-row" data-aired={episode.aired}>
      <input
        type="checkbox"
        className="episode__box"
        checked={episode.watched}
        disabled={!episode.aired}
        onChange={onToggle}
        data-testid="episode-toggle"
        aria-label={`Mark ${code}${episode.title === null ? "" : ` ${episode.title}`} watched`}
      />
      <Link
        to="/show/$showId/episode/$season/$episode"
        params={{
          showId: String(showId),
          season: String(episode.season),
          episode: String(episode.number),
        }}
        className="episode__link"
        data-testid="episode-link"
      >
        <span className="episode__code">{code}</span>
        <span className="episode__title">{episode.title ?? "Untitled"}</span>
      </Link>
      <span className="episode__meta">
        {episode.aired ? (
          <button
            type="button"
            className="button button--ghost button--sm"
            data-testid="mark-up-to-here"
            onClick={onMarkUpToHere}
          >
            Mark up to here
          </button>
        ) : (
          <span className="episode__unaired" data-testid="episode-unaired">
            Airs {airLabel(episode.firstAired)}
          </span>
        )}
      </span>
    </li>
  );
}
