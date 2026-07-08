import type { TmdbImageConfig } from "@data/image-source";
import { Link } from "@tanstack/react-router";
import { MarkWatchedButton } from "@ui/components/MarkWatchedButton";
import { episodeCode, relativeDays, watchedPercent } from "@ui/format";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import type { ReactElement } from "react";
import { Poster } from "./Poster";

interface UpNextCardProps {
  readonly card: UpNextCardModel;
  readonly tmdbConfig: TmdbImageConfig | null;
  /** The first card of the honest sort renders `lead` — larger and calmer, but not
   * a cinematic recommendation (it is simply first-in-sort, not a "for you" pick). */
  readonly variant?: "lead" | "queue";
  onMark(): void;
}

/**
 * One Up Next row: poster + title route to the Show page, the
 * amber episode code + name route to the Episode page, a quiet "last watched N days
 * ago" line, and one shared "Mark watched" ACTION that marks in place. The lead
 * card carries a "Next up" eyebrow so the biggest card reads as what-to-watch-next
 * (not what-you-just-watched), and on the lead the action drops to its own full-width
 * row so a long title stays legible at 390px. The mark button locks while an
 * optimistic advance awaits its authoritative refetch so a provisional episode is
 * never re-marked.
 */
export function UpNextCard({
  card,
  tmdbConfig,
  variant = "queue",
  onMark,
}: UpNextCardProps): ReactElement {
  const { entry, item } = card;
  const code = episodeCode(item.episode.season, item.episode.number);
  const percent = watchedPercent(entry.completed, entry.aired);
  const lastWatched = relativeDays(entry.lastWatchedAt, Date.now());
  const showParams = { showId: String(entry.showId) };
  const isLead = variant === "lead";

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
          <Poster
            title={entry.title}
            posters={entry.posters}
            tmdbConfig={tmdbConfig}
            variant="queue"
          />
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
        {lastWatched !== null && (
          <p className="card__meta" data-testid="last-watched">
            last watched {lastWatched}
          </p>
        )}
      </div>

      <MarkWatchedButton
        testId="mark-watched"
        label="Mark watched"
        ariaLabel={`Mark ${entry.title} ${code} watched`}
        busy={entry.pendingAdvance}
        onMark={onMark}
      />
    </article>
  );
}
