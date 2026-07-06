import type { TmdbImageConfig } from "@data/image-source";
import type { SearchHit } from "@data/trakt/search";
import { Link } from "@tanstack/react-router";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement, ReactNode } from "react";

interface DiscoverCardProps {
  readonly hit: SearchHit;
  readonly tmdbConfig: TmdbImageConfig | null;
  readonly added: boolean;
  onAdd(): void;
}

/**
 * One Discover tile — a poster-forward 2:3 card shared by the browse rails and
 * the search results grid. Every poster is a single link into its detail page
 * (the "tap any poster → detail" rule): shows to /show/$showId, movies to
 * /movie/$movieId. The inline watchlist add is a sibling of the link (never nested
 * in the anchor) so both are independent tab stops, and it reflects the optimistic
 * added state with a lock against a double-add.
 */
export function DiscoverCard({ hit, tmdbConfig, added, onAdd }: DiscoverCardProps): ReactElement {
  const poster = (
    <span className="poster-wrap poster-wrap--tile">
      <Poster title={hit.title} posters={hit.posters} tmdbConfig={tmdbConfig} variant="tile" />
    </span>
  );

  const frame: ReactNode =
    hit.type === "show" ? (
      <Link
        to="/show/$showId"
        params={{ showId: String(hit.traktId) }}
        className="discover-card__poster"
        aria-label={`Open ${hit.title}`}
      >
        {poster}
      </Link>
    ) : (
      <Link
        to="/movie/$movieId"
        params={{ movieId: String(hit.traktId) }}
        className="discover-card__poster"
        aria-label={`Open ${hit.title}`}
      >
        {poster}
      </Link>
    );

  return (
    <article className="discover-card" data-testid="search-result" data-trakt-id={hit.traktId}>
      <div className="discover-card__frame">
        {frame}
        <button
          type="button"
          className="discover-card__add"
          data-testid="search-add"
          aria-label={added ? `${hit.title} added to watchlist` : `Add ${hit.title} to watchlist`}
          data-added={added}
          disabled={added}
          onClick={onAdd}
        >
          {added ? "Added" : "Add"}
        </button>
      </div>
      <div className="discover-card__meta">
        <h3 className="discover-card__title" title={hit.title}>
          {hit.title}
        </h3>
        <p className="discover-card__sub">
          <span className="discover-card__badge" data-testid="search-result-type">
            {hit.type === "movie" ? "Movie" : "Show"}
          </span>
          {hit.year !== null && <span className="discover-card__year">{hit.year}</span>}
        </p>
      </div>
    </article>
  );
}
