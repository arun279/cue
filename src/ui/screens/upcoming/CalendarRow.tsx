import type { TmdbImageConfig } from "@data/image-source";
import { CALENDAR_TIME_ZONE, type CalendarRow as CalendarRowModel } from "@domain/calendar";
import { Link } from "@tanstack/react-router";
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
  timeZone: CALENDAR_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/**
 * One calendar episode row: poster, show + next-episode code/title, localized air
 * time, linking into Episode detail. An already-aired episode gets the quick
 * mark-watched control; once marked it collapses to a confirmed badge. A
 * not-yet-aired episode shows no action — you can't have watched it yet.
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
        <button
          type="button"
          className="card__mark"
          data-testid="calendar-mark"
          aria-label={`Mark ${row.showTitle} ${code} watched`}
          onClick={onMark}
        >
          <svg className="card__check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span className="calendar-card__soon" data-testid="calendar-upcoming">
          Airs soon
        </span>
      )}
    </article>
  );
}
