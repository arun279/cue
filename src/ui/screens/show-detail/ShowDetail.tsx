import { resolvePoster } from "@data/image-source";
import type { EpisodeView, SeasonView, ShowHeader } from "@data/trakt/show-detail";
import { Link } from "@tanstack/react-router";
import { CheckIcon } from "@ui/components/CheckIcon";
import { DetailHeroSkeleton } from "@ui/components/DetailHeroSkeleton";
import { RatingControl } from "@ui/components/RatingControl";
import { useHideShow } from "@ui/hooks/useHideShow";
import { useLibrarySnapshot } from "@ui/hooks/useLibrarySnapshot";
import type { MarkContextTarget, MarkSeasonController } from "@ui/hooks/useMarkSeason";
import { useMarkSeason } from "@ui/hooks/useMarkSeason";
import { useRate } from "@ui/hooks/useRate";
import { useSeasons } from "@ui/hooks/useSeasons";
import { useShowDetail } from "@ui/hooks/useShowDetail";
import { useToggleWatchlist } from "@ui/hooks/useToggleWatchlist";
import { episodeCode, formatAirDate, titleCase, watchedPercent } from "@ui/screens/up-next/format";
import { Poster } from "@ui/screens/up-next/Poster";
import { Snackbar } from "@ui/screens/up-next/Snackbar";
import { Accordion } from "radix-ui";
import { type ReactElement, useState } from "react";
import { SeasonPanel } from "./SeasonPanel";
import { Still } from "./Still";

const UNDO_MS = 6000;

function backdropUrlOf(header: ShowHeader): string | null {
  const resolved = resolvePoster({ title: header.title, traktPosters: header.backdrops });
  return resolved.source === "placeholder" ? null : resolved.url;
}

/** The full-bleed media hero: backdrop with a scrim fading into the card, poster
 * inset with an amber progress rail, editorial title, broadcast chips, overview,
 * and the primary actions (Mark next / Watchlist / Stop watching) + compact rating. */
function ShowHero({
  header,
  onWatchlist,
  watchlist,
  rate,
  onMarkNext,
  hidden,
  onToggleHidden,
}: {
  readonly header: ShowHeader;
  readonly onWatchlist: boolean;
  readonly watchlist: ReturnType<typeof useToggleWatchlist>;
  readonly rate: ReturnType<typeof useRate>;
  onMarkNext(): void;
  readonly hidden: boolean;
  onToggleHidden(): void;
}): ReactElement {
  const [bdBroken, setBdBroken] = useState(false);
  const backdrop = backdropUrlOf(header);
  const pct = watchedPercent(header.completed, header.aired);
  const next = header.nextEpisode;
  const canMarkNext = next?.aired === true;
  const genres = header.genres.slice(0, 3);
  // Once a show has progress its state is derived from that progress, not from
  // watchlist membership, so hide the watchlist toggle (it would contradict the
  // Library's "Watching" filing). Stop is only meaningful for a show that is
  // actually being watched or already stopped — never a not-started one.
  const showWatchlist = header.completed === 0;
  const canStop = hidden || header.completed > 0;

  return (
    <section className="show-hero">
      {backdrop !== null && !bdBroken && (
        <img
          className="show-hero__backdrop"
          src={backdrop}
          alt=""
          decoding="async"
          data-testid="hero-backdrop"
          onError={() => setBdBroken(true)}
        />
      )}
      <div className="show-hero__scrim" />
      <div className="show-hero__body">
        <span className="poster-wrap show-hero__poster">
          <Poster title={header.title} posters={header.posters} tmdbConfig={null} variant="hero" />
          {header.aired > 0 && (
            <span className="poster__bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>

        <div className="show-hero__info">
          <h1 className="show-hero__title" data-testid="detail-title">
            {header.title}
            {header.year !== null && <span className="show-hero__year"> {header.year}</span>}
          </h1>

          <div className="show-hero__chips">
            {header.network !== null && (
              <span className="chip" data-testid="detail-network">
                {header.network}
              </span>
            )}
            {header.status !== "" && (
              <span className="chip show-hero__status">{header.status}</span>
            )}
            {genres.map((genre) => (
              <span key={genre} className="chip">
                {titleCase(genre)}
              </span>
            ))}
            {header.aired > 0 && (
              <span className="chip">
                {header.aired} episode{header.aired === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {header.overview !== null && (
            <p className="show-hero__overview" data-testid="detail-overview">
              {header.overview}
            </p>
          )}
        </div>
      </div>

      <div className="show-hero__controls">
        <div className="show-hero__progress">
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Overall watched progress"
            data-testid="overall-progress"
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-ratio">
            {header.completed} / {header.aired} watched
          </span>
        </div>

        <div className="show-hero__actions">
          {canMarkNext && (
            <button type="button" className="button" data-testid="mark-next" onClick={onMarkNext}>
              <CheckIcon />
              Mark next watched
            </button>
          )}
          {showWatchlist && (
            <button
              type="button"
              className="button button--ghost"
              aria-pressed={onWatchlist}
              aria-busy={watchlist.isLoading}
              disabled={watchlist.isLoading}
              data-testid="watchlist-toggle"
              data-on={onWatchlist}
              onClick={() => void watchlist.toggle(header.ids)}
            >
              {watchlist.isLoading
                ? "Checking…"
                : onWatchlist
                  ? "On watchlist ✓"
                  : "Add to watchlist"}
            </button>
          )}
          {canStop && (
            <button
              type="button"
              className="show-hero__stop"
              data-testid="hide-show"
              data-hidden={hidden}
              onClick={onToggleHidden}
            >
              {hidden ? "Resume" : "Stop watching"}
            </button>
          )}
        </div>

        {canStop && (
          <p className="show-hero__stop-note" data-testid="stop-note">
            {hidden
              ? "History kept — resume to pick up where you left off."
              : "Stopping keeps your watch history — resume anytime."}
          </p>
        )}

        <div className="show-hero__rating">
          <span className="rating__lead">Your rating</span>
          <RatingControl
            ids={header.ids}
            label={header.title}
            controller={rate}
            testId="show-rating"
          />
        </div>
      </div>
    </section>
  );
}

/** The show-level "Up next" module: the next unwatched episode as a 16:9 still
 * with one-tap Mark watched + Mark up to here (aired), or an air-date callout. */
function NextUp({
  next,
  target,
  seasons,
  marks,
}: {
  readonly next: EpisodeView;
  readonly target: MarkContextTarget;
  readonly seasons: readonly SeasonView[];
  readonly marks: MarkSeasonController;
}): ReactElement {
  const code = episodeCode(next.season, next.number);
  const airDate = formatAirDate(next.firstAired);
  return (
    <section className="next-up" data-testid="next-callout" data-aired={next.aired}>
      <div className="next-up__still">
        <Still title={next.title ?? code} stills={next.stills} />
      </div>
      <div className="next-up__body">
        <p className="next-up__eyebrow">{next.aired ? "Up next" : "Next airs"}</p>
        <p className="next-up__title">
          <span className="next-up__code">{code}</span>
          {next.title !== null && <span className="next-up__name">{next.title}</span>}
        </p>
        {!next.aired && airDate !== null && <p className="next-up__air">Airs {airDate}</p>}
      </div>
      {next.aired && (
        <div className="next-up__actions">
          <button
            type="button"
            className="button button--sm"
            data-testid="next-up-mark"
            onClick={() => void marks.toggleEpisode(target, next)}
          >
            Mark watched
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            data-testid="next-up-catchup"
            disabled={seasons.length === 0}
            onClick={() =>
              void marks.markUpToHere(target, seasons, {
                season: next.season,
                number: next.number,
              })
            }
          >
            Mark up to here
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Show detail as a media page: a full-bleed backdrop hero
 * (poster inset, editorial title, chips, overview, overall progress, primary
 * actions, compact rating) that paints first, a show-level "Up next" module, then
 * the season shelves — each a completion ring + Mark-season header expanding into
 * a shelf of episode stills with watched toggles and "mark up to here". A Stop
 * action drops the show from Up Next and the calendar. Every state is designed:
 * hero skeleton, hero error retry, streaming seasons, season error retry, and an
 * announced-only empty tree.
 */
export function ShowDetail({ showId }: { showId: number }): ReactElement {
  const detail = useShowDetail(showId);
  const seasonsView = useSeasons(showId);
  const marks = useMarkSeason();
  const hide = useHideShow();
  const rate = useRate("shows");
  const watchlist = useToggleWatchlist();
  const [includeSpecials, setIncludeSpecials] = useState(false);
  // Read the shared library snapshot (SWR — cached instantly on navigation, fetched
  // once on a direct /show/:id load) so the abandon action reflects the real hidden
  // state and flips live when the optimistic hide/unhide patches the shared entry.
  const hidden = useLibrarySnapshot().byId.get(showId)?.hidden ?? false;

  const header = detail.header;

  if (detail.isLoading) {
    return (
      <section className="screen screen--detail" data-testid="screen-show-detail">
        <DetailHeroSkeleton testId="detail-skeleton" />
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

  const target: MarkContextTarget = { showId, ids: header.ids, includeSpecials };
  const onWatchlist = watchlist.isOnWatchlist(showId);
  const next = header.nextEpisode;
  const nextKey = next === null ? null : `${next.season}:${next.number}`;

  return (
    <section className="screen screen--detail" data-testid="screen-show-detail">
      <Link to="/library" className="detail-back" data-testid="detail-back">
        ‹ Library
      </Link>

      <ShowHero
        header={header}
        onWatchlist={onWatchlist}
        watchlist={watchlist}
        rate={rate}
        onMarkNext={() => {
          if (next !== null) void marks.toggleEpisode(target, next);
        }}
        hidden={hidden}
        onToggleHidden={() =>
          void (hidden
            ? hide.unhide(showId, header.ids, header.title)
            : hide.hide(showId, header.ids, header.title))
        }
      />

      {next !== null && (
        <NextUp next={next} target={target} seasons={seasonsView.seasons} marks={marks} />
      )}

      <div className="detail-seasons__head">
        <h2 className="detail-seasons__title">Seasons</h2>
        <label className="detail-specials">
          <input
            type="checkbox"
            checked={includeSpecials}
            onChange={(event) => setIncludeSpecials(event.target.checked)}
            data-testid="include-specials"
          />
          Include specials in bulk marks
        </label>
      </div>

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
              nextKey={nextKey}
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
          message={
            hide.undoable.kind === "hide"
              ? `Stopped watching ${hide.undoable.title}.`
              : `Resumed ${hide.undoable.title}.`
          }
          actionLabel="Undo"
          autoDismissMs={UNDO_MS}
          onAction={() => void hide.undo()}
          onDismiss={hide.dismissUndo}
        />
      )}
      {rate.error !== null && (
        <Snackbar
          testId="show-rating-error"
          message={rate.error}
          actionLabel="Dismiss"
          onAction={rate.clearError}
          onDismiss={rate.clearError}
        />
      )}
      {watchlist.error !== null && (
        <Snackbar
          testId="watchlist-error"
          message={watchlist.error}
          actionLabel="Dismiss"
          onAction={watchlist.clearError}
          onDismiss={watchlist.clearError}
        />
      )}
    </section>
  );
}
