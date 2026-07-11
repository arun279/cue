import { Link } from "@tanstack/react-router";
import { InlineUndo } from "@ui/components/InlineUndo";
import { MarkWatchedButton } from "@ui/components/MarkWatchedButton";
import { episodeCode, relativeDays, watchedPercent } from "@ui/format";
import { useShowArt } from "@ui/hooks/useShowArt";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import type { ReactElement } from "react";
import { Poster } from "./Poster";

interface UpNextCardProps {
  readonly card: UpNextCardModel;
  /** The first card of the honest sort renders `lead`: larger and calmer, but not
   * a cinematic recommendation (it is simply first-in-sort, not a "for you" pick). */
  readonly variant?: "lead" | "queue";
  /** Set for the card whose mark just landed: the point-of-action inline Undo,
   * carrying the just-marked episode code and the shared reversal seam. */
  readonly undo?: { readonly code: string; onUndo(): void };
  onMark(): void;
}

/**
 * One Up Next row: poster + title route to the Show page, the
 * amber episode code + name route to the Episode page, a quiet "last watched N days
 * ago" line, and the shared Cue mark (icon-only amber ring) on the trailing edge. The
 * lead card reads as what-to-watch-next purely through its poster + "Next up" eyebrow,
 * NEVER through a differently-styled mark; the ring is identical here and in every
 * queue row. Freed of a text label, the title reclaims that width and may wrap to two
 * lines. The mark locks while an optimistic advance awaits its authoritative refetch
 * so a provisional episode is never re-marked.
 */
export function UpNextCard({
  card,
  variant = "queue",
  undo,
  onMark,
}: UpNextCardProps): ReactElement {
  const { entry, item } = card;
  const code = episodeCode(item.episode.season, item.episode.number);
  const percent = watchedPercent(entry.completed, entry.aired);
  const lastWatched = relativeDays(entry.lastWatchedAt, Date.now());
  const showParams = { showId: String(entry.showId) };
  const isLead = variant === "lead";
  // Art is deferred out of the cold-sync budget: this visible card lazily fetches
  // its own poster, falling back to any inline list poster until it resolves.
  const artPosters = useShowArt(entry.showId);
  const posters = artPosters.length > 0 ? artPosters : entry.posters;

  return (
    <article
      className={isLead ? "card card--up-next card--lead" : "card card--up-next"}
      data-testid="up-next-card"
      data-show-id={entry.showId}
    >
      <Link
        to="/show/$showId"
        params={showParams}
        className="card__poster-link"
        tabIndex={-1}
        aria-label={entry.title}
      >
        <span className={isLead ? "poster-wrap" : "poster-wrap poster-wrap--sm"}>
          <Poster title={entry.title} posters={posters} variant="queue" />
          <span className="poster__bar" aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </span>
        </span>
      </Link>

      <div className="card__body">
        {isLead && <p className="card__eyebrow">Next up</p>}
        <Link to="/show/$showId" params={showParams} className="card__title-link">
          <h2 className="card__title">{entry.title}</h2>
        </Link>
        <Link
          to="/show/$showId/episode/$season/$episode"
          params={{
            showId: String(entry.showId),
            season: String(item.episode.season),
            episode: String(item.episode.number),
          }}
          className="card__episode"
          data-testid="up-next-card-link"
          aria-label={`${entry.title} ${code} episode details`}
        >
          <span className="card__code" data-testid="episode-code">
            {code}
          </span>
          {item.episode.title !== null && (
            <span className="card__episode-title">{item.episode.title}</span>
          )}
        </Link>
        {undo ? (
          <InlineUndo
            testId="mark-undo"
            label={`Marked ${undo.code} watched`}
            ariaLabel={`Undo: mark ${entry.title} ${undo.code} unwatched`}
            onUndo={undo.onUndo}
          />
        ) : (
          lastWatched !== null && (
            <p className="card__meta" data-testid="last-watched">
              last watched {lastWatched}
            </p>
          )
        )}
      </div>

      <MarkWatchedButton
        testId="mark-watched"
        ariaLabel={`Mark ${entry.title} ${code} watched`}
        busy={entry.pendingAdvance}
        onMark={onMark}
      />
    </article>
  );
}
