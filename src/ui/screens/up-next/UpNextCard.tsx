import type { TmdbImageConfig } from "@data/image-source";
import type { UpNextCard as UpNextCardModel } from "@ui/hooks/useUpNext";
import type { ReactElement } from "react";
import { Poster } from "./Poster";

interface UpNextCardProps {
  readonly card: UpNextCardModel;
  readonly tmdbConfig: TmdbImageConfig | null;
  onMark(): void;
}

function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

/**
 * One Up Next row: poster, show title, next-episode code + title, backlog, and
 * the primary mark-watched action. The action locks while an optimistic advance
 * awaits its authoritative refetch, so a provisional episode is never re-marked.
 */
export function UpNextCard({ card, tmdbConfig, onMark }: UpNextCardProps): ReactElement {
  const { entry, item } = card;
  const code = episodeCode(item.episode.season, item.episode.number);
  const pending = entry.pendingAdvance;
  const remaining = item.backlog;

  return (
    <article className="card" data-testid="up-next-card" data-show-id={entry.showId}>
      <Poster entry={entry} tmdbConfig={tmdbConfig} />
      <div className="card__body">
        <h2 className="card__title">{entry.title}</h2>
        <p className="card__episode">
          <span className="card__code" data-testid="episode-code">
            {code}
          </span>
          {item.episode.title !== null && (
            <span className="card__episode-title">{item.episode.title}</span>
          )}
        </p>
        {remaining > 0 && (
          <p className="card__backlog" data-testid="backlog">
            {remaining} to watch
          </p>
        )}
      </div>
      <button
        type="button"
        className="card__mark"
        data-testid="mark-watched"
        aria-label={`Mark ${entry.title} ${code} watched`}
        disabled={pending}
        aria-busy={pending}
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
    </article>
  );
}
