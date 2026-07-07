import type { TmdbImageConfig } from "@data/image-source";
import type { CalendarRow as CalendarRowModel } from "@domain/calendar";
import { localTimeZone } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { MarkWatchedButton } from "@ui/components/MarkWatchedButton";
import { Poster } from "@ui/screens/up-next/Poster";
import type { ReactElement } from "react";

interface CalendarRowProps {
  readonly row: CalendarRowModel;
  readonly tmdbConfig: TmdbImageConfig | null;
  readonly watched: boolean;
  onMark(): void;
}

function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

/**
 * One calendar episode row: poster, show + next-episode code/title, localized air
 * time, linking into Episode detail. An already-aired episode gets the SAME shared
 * "Mark watched" action as Up Next (not a bare icon); once marked it collapses to a
 * confirmed badge. A not-yet-aired episode shows no action — you can't have watched
 * it yet.
 */
export function CalendarRow({ row, tmdbConfig, watched, onMark }: CalendarRowProps): ReactElement {
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
      {watched ? (
        <span className="badge badge--ok" data-testid="calendar-watched">
          Watched
        </span>
      ) : row.aired ? (
        <MarkWatchedButton
          testId="calendar-mark"
          label="Mark watched"
          ariaLabel={`Mark ${row.showTitle} ${code} watched`}
          className="card__mark--sm"
          onMark={onMark}
        />
      ) : (
        <span className="calendar-card__soon" data-testid="calendar-upcoming">
          Airs soon
        </span>
      )}
    </article>
  );
}
