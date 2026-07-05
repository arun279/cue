import type { TmdbImageConfig } from "@data/image-source";
import type { SearchHit } from "@data/trakt/search";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface SearchResultRowProps {
  readonly hit: SearchHit;
  readonly tmdbConfig: TmdbImageConfig | null;
  readonly added: boolean;
  onAdd(): void;
}

/**
 * One search result: poster, title + year, a show/movie type badge, and the
 * inline "Add to watchlist" action. Once added the button reflects the
 * optimistic state and locks so a double-tap can't enqueue a duplicate add.
 */
export function SearchResultRow({
  hit,
  tmdbConfig,
  added,
  onAdd,
}: SearchResultRowProps): ReactElement {
  const typeLabel = hit.type === "movie" ? "Movie" : "Show";
  return (
    <article className="card" data-testid="search-result" data-trakt-id={hit.traktId}>
      <Poster title={hit.title} posters={hit.posters} tmdbConfig={tmdbConfig} />
      <div className="card__body">
        <h2 className="card__title">
          {hit.title}
          {hit.year !== null && <span className="search-result__year"> ({hit.year})</span>}
        </h2>
        <span className="badge search-result__badge" data-testid="search-result-type">
          {typeLabel}
        </span>
      </div>
      <button
        type="button"
        className="button button--sm"
        data-testid="search-add"
        aria-label={`Add ${hit.title} to watchlist`}
        disabled={added}
        onClick={onAdd}
      >
        {added ? "Added" : "Add"}
      </button>
    </article>
  );
}
