import type { SearchHit } from "@data/trakt/search";
import { Badge } from "@ui/components/Badge";
import { EpisodeRow, type EpisodeRowLink } from "@ui/components/EpisodeRow";
import { Poster } from "@ui/screens/up-next/Poster";
import { type ReactElement, useEffect, useRef, useState } from "react";

/** How long the filled "Added ✓" confirmation holds before settling into the
 * quiet "In library" state. */
const ADDED_FLASH_MS = 600;

interface ResultRowProps {
  readonly hit: SearchHit;
  readonly added: boolean;
  onAdd(hit: SearchHit): void;
}

function linkFor(hit: SearchHit): EpisodeRowLink {
  return hit.type === "movie"
    ? { to: "/movie/$movieId", params: { movieId: String(hit.traktId) } }
    : { to: "/show/$showId", params: { showId: String(hit.traktId) } };
}

/**
 * One search result: poster, title + SHOW/MOVIE badge + year, the body a link
 * into detail. The trailing control is always "+ Watchlist",
 * flashing to a filled "Added ✓" on tap before settling into the static
 * "In library" chip. No control ever covers poster art.
 */
export function ResultRow({ hit, added, onAdd }: ResultRowProps): ReactElement {
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const press = (): void => {
    setJustAdded(true);
    timer.current = setTimeout(() => setJustAdded(false), ADDED_FLASH_MS);
    onAdd(hit);
  };

  const trailing = justAdded ? (
    <span className="add-pill" data-state="added" data-testid="search-added">
      Added ✓
    </span>
  ) : added ? (
    <span className="in-library" data-testid="search-in-library">
      In library
    </span>
  ) : (
    <button
      type="button"
      className="add-pill"
      data-testid="search-add"
      aria-label={`Add ${hit.title} to Watchlist`}
      onClick={press}
    >
      + Watchlist
    </button>
  );

  return (
    <EpisodeRow
      variant="search"
      testId="search-result"
      art={<Poster title={hit.title} posters={hit.posters} variant="s44" />}
      title={
        <>
          <span className="search-hit-title">{hit.title}</span>
          <Badge variant="media-type" testId="search-result-type">
            {hit.type === "movie" ? "Movie" : "Show"}
          </Badge>
        </>
      }
      meta={hit.year ?? undefined}
      trailing={trailing}
      link={linkFor(hit)}
      linkLabel={`${hit.title}, ${hit.type === "movie" ? "Movie" : "Show"}${
        hit.year === null ? "" : `, ${hit.year}`
      }`}
    />
  );
}
