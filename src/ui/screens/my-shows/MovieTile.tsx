import type { MovieEntry } from "@data/trakt/movie-library";
import { Link } from "@tanstack/react-router";
import { Badge } from "@ui/components/Badge";
import { Poster } from "@ui/screens/up-next/Poster";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

/**
 * One Library movie tile: 2:3 poster + 1-line caption linking into Movie
 * detail. Watched movies carry the green done badge; watchlist movies their
 * release year. Overlays are aria-hidden — the active chip names the state.
 */
export function MovieTile({ entry }: { readonly entry: MovieEntry }): ReactElement {
  return (
    <Link
      to="/movie/$movieId"
      params={{ movieId: String(entry.movieId) }}
      className="poster-tile"
      data-testid="movie-library-card"
      data-movie-id={entry.movieId}
    >
      <span className="poster-tile__art">
        <Poster title={entry.title} posters={entry.posters} variant="s115" />
        {entry.watched ? (
          <span className="library-tile__done" aria-hidden="true">
            <Check />
          </span>
        ) : (
          entry.year !== null && (
            <span className="poster-tile__badge" aria-hidden="true">
              <Badge variant="year">{entry.year}</Badge>
            </span>
          )
        )}
      </span>
      <span className="poster-tile__title">{entry.title}</span>
    </Link>
  );
}
