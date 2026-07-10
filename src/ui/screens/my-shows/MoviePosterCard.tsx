import type { MovieEntry } from "@data/trakt/movie-library";
import { Link } from "@tanstack/react-router";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface MoviePosterCardProps {
  readonly entry: MovieEntry;
}

/**
 * One My Shows movie tile: a poster-forward 2:3 card with the title and release
 * year, plus a "Watchlist" hint when the movie is queued but unwatched. The whole
 * tile is a single link into Movie detail (the "tap any poster → detail"
 * rule) — one tab stop with an accessible name, not a nested control.
 */
export function MoviePosterCard({ entry }: MoviePosterCardProps): ReactElement {
  return (
    <Link
      to="/movie/$movieId"
      params={{ movieId: String(entry.movieId) }}
      className="poster-card"
      data-testid="movie-library-card"
      data-movie-id={entry.movieId}
    >
      <span className="poster-wrap poster-wrap--tile">
        <Poster variant="tile" title={entry.title} posters={entry.posters} />
      </span>

      <div className="poster-card__meta">
        <h3 className="poster-card__title">{entry.title}</h3>
        <p className="poster-card__progress" data-testid="movie-card-sub">
          {entry.year !== null && <span className="poster-card__count">{entry.year}</span>}
          {!entry.watched && entry.inWatchlist && (
            <span className="poster-card__next">Watchlist</span>
          )}
        </p>
      </div>
    </Link>
  );
}
