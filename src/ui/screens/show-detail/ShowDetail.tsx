import { resolvePoster } from "@data/image-source";
import type { ShowHeader } from "@data/trakt/show-detail";
import { Link } from "@tanstack/react-router";
import { useHideShow } from "@ui/hooks/useHideShow";
import type { MarkContextTarget } from "@ui/hooks/useMarkSeason";
import { useMarkSeason } from "@ui/hooks/useMarkSeason";
import { useSeasons } from "@ui/hooks/useSeasons";
import { useShowDetail } from "@ui/hooks/useShowDetail";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { Accordion } from "radix-ui";
import { type ReactElement, useState } from "react";
import { SeasonPanel } from "./SeasonPanel";

const UNDO_MS = 6000;

function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words.length === 0
    ? "?"
    : words
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
}

function HeroArt({ header }: { header: ShowHeader }): ReactElement {
  const backdrop = header.backdrops.find((url) => url.length > 0);
  const poster = resolvePoster({ title: header.title, traktPosters: header.posters });
  return (
    <div className="hero__art">
      {backdrop !== undefined && (
        <img
          className="hero__backdrop"
          src={/^https?:\/\//.test(backdrop) ? backdrop : `https://${backdrop}`}
          alt=""
          data-testid="hero-backdrop"
        />
      )}
      {poster.source === "placeholder" ? (
        <div className="poster poster--text hero__poster" data-testid="hero-poster-text">
          <span className="poster__initials" aria-hidden="true">
            {initials(header.title)}
          </span>
        </div>
      ) : (
        <img className="poster hero__poster" src={poster.url} alt="" data-testid="hero-poster" />
      )}
    </div>
  );
}

function NextCallout({ header }: { header: ShowHeader }): ReactElement | null {
  const next = header.nextEpisode;
  if (next === null) return null;
  const code = episodeCode(next.season, next.number);
  return (
    <p className="hero__next" data-testid="next-callout">
      {next.aired ? "Next up: " : "Next airs: "}
      <strong>{code}</strong>
      {next.title !== null && ` · ${next.title}`}
    </p>
  );
}

/**
 * Show detail: a hero (backdrop + poster + overview + network +
 * next-air callout + overall progress) that paints first, then the season stream
 * with per-episode watched toggles and the batched Mark-season / Mark-up-to-here
 * actions. A Hide (Stop) action drops the show from Up Next and the calendar.
 * Every state is designed: hero skeleton, hero error retry, streaming seasons,
 * season error retry, and an announced-only empty tree.
 */
export function ShowDetail({ showId }: { showId: number }): ReactElement {
  const detail = useShowDetail(showId);
  const seasonsView = useSeasons(showId);
  const marks = useMarkSeason();
  const hide = useHideShow();
  const [includeSpecials, setIncludeSpecials] = useState(false);

  const header = detail.header;

  if (detail.isLoading) {
    return (
      <section className="screen screen--detail" data-testid="screen-show-detail">
        <div className="hero hero--skeleton" data-testid="detail-skeleton">
          <div className="poster poster--skeleton hero__poster" />
          <div className="hero__body">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--sub" />
          </div>
        </div>
      </section>
    );
  }

  if (header === undefined) {
    return (
      <section className="screen screen--detail" data-testid="screen-show-detail">
        <div className="empty" data-testid="detail-error">
          <h2 className="empty__title">Couldn't load this show</h2>
          <p className="empty__body">Check your connection and try again.</p>
          <button
            type="button"
            className="button"
            data-testid="detail-error-retry"
            onClick={detail.refetch}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const pct = header.aired > 0 ? Math.round((header.completed / header.aired) * 100) : 0;
  const target: MarkContextTarget = { showId, ids: header.ids, includeSpecials };

  return (
    <section className="screen screen--detail" data-testid="screen-show-detail">
      <Link to="/my-shows" className="detail-back" data-testid="detail-back">
        ← My Shows
      </Link>

      <header className="hero">
        <HeroArt header={header} />
        <div className="hero__body">
          <h1 className="hero__title" data-testid="detail-title">
            {header.title}
            {header.year !== null && <span className="hero__year"> ({header.year})</span>}
          </h1>
          <p className="hero__meta">
            {header.network !== null && <span data-testid="detail-network">{header.network}</span>}
            {header.status !== "" && <span className="hero__status">{header.status}</span>}
          </p>
          {header.overview !== null && (
            <p className="hero__overview" data-testid="detail-overview">
              {header.overview}
            </p>
          )}
          <NextCallout header={header} />
          <div className="hero__progress">
            <div
              className="progress-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall watched progress"
              data-testid="overall-progress"
            >
              <span className="progress-bar__fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="hero__count">
              {header.completed}/{header.aired} watched
            </span>
          </div>
          <div className="hero__actions">
            <button
              type="button"
              className="button button--danger button--sm"
              data-testid="hide-show"
              onClick={() => void hide.hide(showId, header.ids, header.title)}
            >
              Stop watching
            </button>
            <label className="hero__specials">
              <input
                type="checkbox"
                checked={includeSpecials}
                onChange={(event) => setIncludeSpecials(event.target.checked)}
                data-testid="include-specials"
              />
              Include specials in bulk marks
            </label>
          </div>
        </div>
      </header>

      <h2 className="detail-seasons__title">Seasons</h2>
      {seasonsView.isLoading && (
        <p className="detail-seasons__loading" role="status" data-testid="seasons-loading">
          Loading seasons…
        </p>
      )}
      {!seasonsView.isLoading && seasonsView.isError && !seasonsView.hasData && (
        <div className="banner banner--warn" role="alert" data-testid="seasons-error">
          <span>Couldn't load the seasons for this show.</span>
          <button
            type="button"
            className="button button--ghost button--sm"
            data-testid="seasons-error-retry"
            onClick={seasonsView.refetch}
          >
            Retry
          </button>
        </div>
      )}
      {!seasonsView.isLoading && seasonsView.hasData && seasonsView.seasons.length === 0 && (
        <div className="empty" data-testid="seasons-empty">
          <h2 className="empty__title">No episodes announced yet</h2>
          <p className="empty__body">We'll list seasons here as soon as this show has episodes.</p>
        </div>
      )}
      {seasonsView.seasons.length > 0 && (
        <Accordion.Root type="multiple" className="season-list" data-testid="season-list">
          {seasonsView.seasons.map((season) => (
            <SeasonPanel
              key={season.number}
              season={season}
              allSeasons={seasonsView.seasons}
              target={target}
              marks={marks}
            />
          ))}
        </Accordion.Root>
      )}

      {marks.error !== null && (
        <Snackbar
          testId="season-mark-error"
          message={marks.error}
          actionLabel="Dismiss"
          onAction={marks.clearError}
          onDismiss={marks.clearError}
        />
      )}
      {marks.undoable !== null && (
        <Snackbar
          testId="season-undo"
          message={marks.undoable.label}
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void marks.undo()}
          onDismiss={marks.dismissUndo}
        />
      )}
      {hide.error !== null && (
        <Snackbar
          testId="hide-error"
          message={hide.error}
          actionLabel="Dismiss"
          onAction={hide.clearError}
          onDismiss={hide.clearError}
        />
      )}
      {hide.undoable !== null && (
        <Snackbar
          testId="hide-undo"
          message={`Stopped ${hide.undoable.title}.`}
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void hide.undo()}
          onDismiss={hide.dismissUndo}
        />
      )}
    </section>
  );
}
