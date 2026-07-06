import type { TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import { Link } from "@tanstack/react-router";
import { episodeCode, watchedPercent } from "@ui/screens/up-next/format";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface PosterCardProps {
  readonly entry: LibraryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
}

/**
 * One My Shows library tile: a poster-forward 2:3 card carrying an amber progress
 * rail pinned to the poster edge, the title, a `watched/aired` ratio, and the
 * next-episode code hint. The whole tile is a single link target into Show detail
 * (the global "tap any poster → Show page" rule) — one tab stop with an
 * accessible name, not a nested control.
 */
export function PosterCard({ entry, tmdbConfig }: PosterCardProps): ReactElement {
  const percent = watchedPercent(entry.completed, entry.aired);
  const next = entry.nextEpisode;

  return (
    <Link
      to="/show/$showId"
      params={{ showId: String(entry.showId) }}
      className="poster-card"
      data-testid="library-card"
      data-show-id={entry.showId}
    >
      <span className="poster-wrap poster-wrap--tile">
        <Poster
          title={entry.title}
          posters={entry.posters}
          tmdbConfig={tmdbConfig}
          variant="tile"
        />
        {entry.aired > 0 && (
          <span className="poster__bar" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>

      <div className="poster-card__meta">
        <h3 className="poster-card__title">{entry.title}</h3>
        <p className="poster-card__progress" data-testid="library-progress">
          {entry.aired > 0 ? (
            <span className="poster-card__count">
              {entry.completed}/{entry.aired}
            </span>
          ) : (
            <span className="poster-card__count poster-card__count--idle">Not started</span>
          )}
          {next !== null && (
            <span className="poster-card__next code">{episodeCode(next.season, next.number)}</span>
          )}
        </p>
      </div>
    </Link>
  );
}
