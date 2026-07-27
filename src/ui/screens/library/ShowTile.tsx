import type { LibraryEntry } from "@data/trakt/library";
import { Link } from "@tanstack/react-router";
import { Badge } from "@ui/components/Badge";
import { ProgressBar } from "@ui/components/ProgressBar";
import { episodesLeft, watchedPercent } from "@ui/format";
import type { LibraryChipKey } from "@ui/hooks/useLibraryBuckets";
import { useShowArt } from "@ui/hooks/useShowArt";
import { Poster } from "@ui/screens/up-next/Poster";
import { Check } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

interface ShowTileProps {
  readonly entry: LibraryEntry;
  /** The chip this tile renders under; picks the overlay grammar. */
  readonly chip: LibraryChipKey;
}

/**
 * One Library show tile: 2:3 poster + 1-line caption, the whole cell a link
 * into Show detail. The active chip decides the overlay: Watching gets the
 * scrim + progress bar + remaining count (number and bar, never color alone),
 * Stopped a PAUSED tag, Finished the green done badge. Overlays are aria-hidden:
 * the chip already names the state, so the link's accessible name stays the title.
 */
export function ShowTile({ entry, chip }: ShowTileProps): ReactElement {
  // Art is deferred out of the cold-sync budget: a tile that settles on screen
  // reads its own poster.
  const art = useShowArt(entry.showId);
  const left = episodesLeft(entry.aired, entry.completed);

  let overlay: ReactNode = null;
  if (chip === "watching") {
    overlay = (
      <span aria-hidden="true">
        <span className="library-tile__scrim" />
        <ProgressBar
          percent={watchedPercent(entry.completed, entry.aired)}
          className="library-tile__bar"
        />
        {left > 0 && (
          <span className="library-tile__left" data-testid="library-remaining">
            {left}
          </span>
        )}
      </span>
    );
  } else if (chip === "stopped") {
    overlay = (
      <span className="poster-tile__badge" aria-hidden="true">
        <Badge variant="paused">PAUSED</Badge>
      </span>
    );
  } else if (chip === "finished") {
    overlay = (
      <span className="library-tile__done" aria-hidden="true">
        <Check />
      </span>
    );
  }

  return (
    <Link
      ref={art.ref}
      to="/show/$showId"
      params={{ showId: String(entry.showId) }}
      className="poster-tile"
      data-testid="library-card"
      data-show-id={entry.showId}
    >
      <span className="poster-tile__art">
        <Poster title={entry.title} posters={art.posters} variant="s115" />
        {overlay}
      </span>
      <span className="poster-tile__title">{entry.title}</span>
    </Link>
  );
}
