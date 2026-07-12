import { Link } from "@tanstack/react-router";
import { Badge } from "@ui/components/Badge";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface PosterTileProps {
  readonly showId: number;
  readonly title: string;
  readonly posters?: readonly string[] | null;
  /** Optional corner badge (year on watchlist tiles; more variants land with Library). */
  readonly badge?: string;
  readonly testId?: string;
}

/**
 * One grid poster cell: 2:3 art with a 1-line caption beneath, the whole cell a
 * link to the show. Library's overlay variants (progress, remaining count,
 * PAUSED, finished) layer onto this same shell.
 */
export function PosterTile({
  showId,
  title,
  posters,
  badge,
  testId,
}: PosterTileProps): ReactElement {
  return (
    <Link
      to="/show/$showId"
      params={{ showId: String(showId) }}
      className="poster-tile"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <span className="poster-tile__art">
        <Poster title={title} posters={posters} variant="s115" />
        {badge !== undefined && (
          <span className="poster-tile__badge">
            <Badge variant="year">{badge}</Badge>
          </span>
        )}
      </span>
      <span className="poster-tile__title">{title}</span>
    </Link>
  );
}
