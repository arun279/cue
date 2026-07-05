import type { TmdbImageConfig } from "@data/image-source";
import type { LibraryEntry } from "@data/trakt/library";
import { Link } from "@tanstack/react-router";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface ShowRowProps {
  readonly entry: LibraryEntry;
  readonly tmdbConfig: TmdbImageConfig | null;
}

/**
 * One My Shows library tile: poster + title + `watched/aired` progress and the
 * remaining backlog, linking into Show detail. The whole tile is the link target
 * (a single tab stop with an accessible name) rather than a nested control.
 */
export function ShowRow({ entry, tmdbConfig }: ShowRowProps): ReactElement {
  const remaining = Math.max(0, entry.aired - entry.completed);
  return (
    <Link
      to="/show/$showId"
      params={{ showId: String(entry.showId) }}
      className="library-card"
      data-testid="library-card"
      data-show-id={entry.showId}
    >
      <Poster entry={entry} tmdbConfig={tmdbConfig} />
      <div className="library-card__body">
        <h3 className="library-card__title">{entry.title}</h3>
        <p className="library-card__progress" data-testid="library-progress">
          <span className="library-card__count">
            {entry.completed}/{entry.aired}
          </span>
          {remaining > 0 && <span className="library-card__backlog">{remaining} to watch</span>}
        </p>
      </div>
    </Link>
  );
}
