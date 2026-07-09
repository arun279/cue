import type { TmdbImageConfig } from "@data/image-source";
import type { CalendarRow as CalendarRowModel } from "@domain/calendar";
import { localTimeZone } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { InlineUndo } from "@ui/components/InlineUndo";
import { MarkWatchedButton } from "@ui/components/MarkWatchedButton";
import { episodeCode } from "@ui/format";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface CalendarRowProps {
  readonly row: CalendarRowModel;
  readonly tmdbConfig: TmdbImageConfig | null;
  readonly watched: boolean;
  /** True for the row whose mark just landed: show the point-of-action inline Undo
   * beside the green done disc for the reversal window. */
  readonly isUndoTarget: boolean;
  onUndo(): void;
  onMark(): void;
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

/**
 * One calendar episode row: poster, show + next-episode code/title, localized air
 * time, linking into Episode detail. An already-aired episode gets the SAME shared Cue
 * mark as Up Next — an amber ring that flips IN PLACE to a GREEN done check the instant
 * it is marked (amber = action, green = done). Its PRIMARY reversal is the inline Undo
 * that appears beside the done disc for the reversal window; the snackbar is the
 * secondary announce and durable per-play reversal lives in History. A not-yet-aired
 * episode shows no mark — you can't have watched it yet.
 */
export function CalendarRow({
  row,
  tmdbConfig,
  watched,
  isUndoTarget,
  onUndo,
  onMark,
}: CalendarRowProps): ReactElement {
  const code = episodeCode(row.season, row.number);
  const airTime = timeFmt.format(new Date(row.firstAired));

  return (
    <article className="card calendar-card" data-testid="calendar-row" data-show-id={row.showId}>
      <Poster title={row.showTitle} posters={row.posters} tmdbConfig={tmdbConfig} />
      <Link
        to="/show/$showId/episode/$season/$episode"
        params={{
          showId: String(row.showId),
          season: String(row.season),
          episode: String(row.number),
        }}
        className="card__link"
        data-testid="calendar-row-link"
        aria-label={`${row.showTitle} ${code} details`}
      >
        <div className="card__body">
          <h3 className="card__title">{row.showTitle}</h3>
          <p className="card__episode">
            <span className="card__code" data-testid="episode-code">
              {code}
            </span>
            {row.episodeTitle !== null && (
              <span className="card__episode-title">{row.episodeTitle}</span>
            )}
          </p>
          <p className="calendar-card__time">{airTime}</p>
        </div>
      </Link>
      {row.aired ? (
        <div className="calendar-card__action">
          <MarkWatchedButton
            testId={watched ? "calendar-watched" : "calendar-mark"}
            watched={watched}
            ariaLabel={`Mark ${row.showTitle} ${code} watched`}
            watchedAriaLabel={`${row.showTitle} ${code} watched`}
            onMark={onMark}
          />
          {isUndoTarget && (
            <InlineUndo
              testId="calendar-undo-inline"
              ariaLabel={`Undo — mark ${row.showTitle} ${code} unwatched`}
              onUndo={onUndo}
            />
          )}
        </div>
      ) : (
        <span className="calendar-card__soon" data-testid="calendar-upcoming">
          Airs soon
        </span>
      )}
    </article>
  );
}
