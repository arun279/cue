import type { SearchHit } from "@data/trakt/search";
import { Link } from "@tanstack/react-router";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement, ReactNode } from "react";

interface DiscoverListProps {
  readonly hits: readonly SearchHit[];
  isAdded(hit: SearchHit): boolean;
  onAdd(hit: SearchHit): void;
  readonly testId: string;
}

/**
 * Render a list of hits as DiscoverCards: the one place a hit becomes a tile.
 * Both discovery idioms (the results grid and the bounded rail) differ only in
 * their container and whether the list is capped; the tile itself is identical,
 * so it lives here and neither wrapper repeats it.
 */
function discoverTiles({
  hits,
  isAdded,
  onAdd,
}: Omit<DiscoverListProps, "testId">): readonly ReactElement[] {
  return hits.map((hit) => (
    <DiscoverCard key={hit.key} hit={hit} added={isAdded(hit)} onAdd={() => onAdd(hit)} />
  ));
}

/**
 * A static poster grid of DiscoverCards: reserved for an EXPLICIT query's
 * results, which the user asked for and can legitimately be a full wrapping grid.
 * Default browse (trending/popular) and in-context "More like this" use the bounded
 * {@link DiscoverRail} instead, so discovery never inflates a page into a scroll
 * wall. Membership + add are injected so both idioms serve every
 * caller (search state, or the standalone watchlist-add hook on detail).
 */
export function DiscoverGrid({ testId, ...list }: DiscoverListProps): ReactElement {
  return (
    <div className="poster-grid--static" data-testid={testId}>
      {discoverTiles(list)}
    </div>
  );
}

/**
 * The bounded browse sample: a top-ten of DiscoverCards on ONE horizontal
 * snap-scroll track at a fixed height. This is the only shape
 * discovery is allowed to take outside the Discover tab's own search results:
 * trending/popular and the Movie-detail "More like this" rail are legitimate
 * recognition-over-recall, but a wrapping grid of 24 buried the user's own data
 * under a 9k-16.6k-px wall. A rail scrolls sideways instead, so its height is one
 * row regardless of count, and the count is capped to a "top ten" sample (the
 * catalog lives in search, not in a browse rail).
 */
const RAIL_MAX = 10;

export function DiscoverRail({ testId, hits, ...list }: DiscoverListProps): ReactElement {
  return (
    <div className="discover-rail__track" data-testid={testId}>
      {discoverTiles({ ...list, hits: hits.slice(0, RAIL_MAX) })}
    </div>
  );
}

interface DiscoverCardProps {
  readonly hit: SearchHit;
  readonly added: boolean;
  onAdd(): void;
}

/**
 * One Discover tile: a poster-forward 2:3 card shared by the browse rails and
 * the search results grid. Every poster is a single link into its detail page
 * (the "tap any poster → detail" rule): shows to /show/$showId, movies to
 * /movie/$movieId. The inline watchlist add is a sibling of the link (never nested
 * in the anchor) so both are independent tab stops, and it reflects the optimistic
 * added state with a lock against a double-add.
 */
function DiscoverCard({ hit, added, onAdd }: DiscoverCardProps): ReactElement {
  const poster = (
    <span className="poster-wrap poster-wrap--tile">
      <Poster title={hit.title} posters={hit.posters} variant="tile" />
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
