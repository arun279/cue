import type { SearchHit } from "@cue/core/data/trakt/search";
import { Link } from "@tanstack/react-router";
import { Badge } from "@ui/components/Badge";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement, ReactNode } from "react";

/**
 * One browse-grid poster cell (trending shows / popular movies): 2:3 art with
 * a year badge and a 1-line caption, the whole cell a link into its detail
 * page. No add control here. Posters are content; adding happens on the
 * result rows and the detail screens.
 */
export function HitTile({ hit }: { readonly hit: SearchHit }): ReactElement {
  const content: ReactNode = (
    <>
      <span className="poster-tile__art">
        <Poster title={hit.title} posters={hit.posters} variant="s115" />
        {hit.year !== null && (
          <span className="poster-tile__badge" aria-hidden="true">
            <Badge variant="year">{hit.year}</Badge>
          </span>
        )}
      </span>
      <span className="poster-tile__title">{hit.title}</span>
    </>
  );

  return hit.type === "movie" ? (
    <Link
      to="/movie/$movieId"
      params={{ movieId: String(hit.traktId) }}
      className="poster-tile"
      data-testid="browse-tile"
    >
      {content}
    </Link>
  ) : (
    <Link
      to="/show/$showId"
      params={{ showId: String(hit.traktId) }}
      className="poster-tile"
      data-testid="browse-tile"
    >
      {content}
    </Link>
  );
}
