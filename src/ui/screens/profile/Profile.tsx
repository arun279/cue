import type { UserStats } from "@data/trakt/schemas";
import { humanizeWatchMinutes } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useStats } from "@ui/hooks/useStats";
import { Diary } from "@ui/screens/profile/Diary";
import type { ReactElement, ReactNode } from "react";

const COUNT = new Intl.NumberFormat("en-US");

interface CountTile {
  readonly key: string;
  readonly testId: string;
  readonly label: string;
  readonly value: number;
}

function countTiles(stats: UserStats): readonly CountTile[] {
  return [
    { key: "episodes", testId: "stat-episodes", label: "Episodes", value: stats.episodes.watched },
    { key: "movies", testId: "stat-movies", label: "Movies", value: stats.movies.watched },
    { key: "shows", testId: "stat-shows", label: "Shows", value: stats.shows.watched },
  ];
}

function isAllZero(stats: UserStats): boolean {
  return stats.episodes.watched === 0 && stats.movies.watched === 0 && stats.shows.watched === 0;
}

function Theatre({ stats }: { readonly stats: UserStats }): ReactElement {
  const time = humanizeWatchMinutes(stats.episodes.minutes + stats.movies.minutes);
  return (
    <div className="stat-theatre" data-testid="stat-theatre">
      <article className="stat-tile stat-tile--hero" data-testid="stat-time">
        <p className="stat-tile__label">Total watch time</p>
        <p className="stat-tile__figure">
          <span className="stat-tile__value">{time.value}</span>
          <span className="stat-tile__unit">{time.unit}</span>
        </p>
        <p className="stat-tile__detail">{time.detail}</p>
      </article>
      <div className="stat-row">
        {countTiles(stats).map((tile) => (
          <article key={tile.key} className="stat-tile" data-testid={tile.testId}>
            <p className="stat-tile__value stat-tile__value--count">{COUNT.format(tile.value)}</p>
            <p className="stat-tile__label">{tile.label}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

const SKELETON_TILES = [0, 1, 2];

function Skeleton(): ReactElement {
  return (
    <div className="stat-theatre" aria-hidden="true" data-testid="profile-skeleton">
      <div className="stat-tile stat-tile--hero stat-tile--skeleton">
        <span className="skeleton-line skeleton-line--sub" />
        <span className="skeleton-line skeleton-line--heading" />
      </div>
      <div className="stat-row">
        {SKELETON_TILES.map((tile) => (
          <div key={tile} className="stat-tile stat-tile--skeleton">
            <span className="skeleton-line skeleton-line--title" />
            <span className="skeleton-line skeleton-line--sub" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Profile — the watch-stats theatre + the Diary. The signed-in
 * user's lifetime totals from `/users/me/stats` in the display face — one featured
 * watch-time figure over a triad of Episodes / Movies / Shows counts — crown a
 * reverse-chronological watch history (Cue's past tense and durable reversal home),
 * so the log rolls up to the numbers above it. Every state is designed — skeleton,
 * hard error with retry, a brand-new-account (all-zero) empty state, and a
 * persistent link into Settings so connections stay one tap away.
 */
export function Profile(): ReactElement {
  useDocumentTitle("Profile · Cue");
  const view = useStats();

  let body: ReactNode;
  if (view.isLoading) {
    body = <Skeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <div className="empty" data-testid="profile-error">
        <h2 className="empty__title">Couldn't load your stats</h2>
        <p className="empty__body">Check your connection and try again.</p>
        <button
          type="button"
          className="button"
          data-testid="profile-error-retry"
          onClick={view.refetch}
        >
          Retry
        </button>
      </div>
    );
  } else if (view.stats === undefined || isAllZero(view.stats)) {
    body = (
      <div className="empty" data-testid="profile-empty">
        <h2 className="empty__title">Your theatre is waiting</h2>
        <p className="empty__body">
          Mark an episode or movie watched and your time watched, episodes, and shows will tally up
          here.
        </p>
        <Link className="button" to="/search" data-testid="profile-empty-discover">
          Find something to watch
        </Link>
      </div>
    );
  } else {
    body = <Theatre stats={view.stats} />;
  }

  return (
    <section className="screen screen--profile" data-testid="screen-profile">
      <header className="screen__head screen__head--stack">
        <h1 className="screen__title">Profile</h1>
        <SyncStatusPill
          testId="profile-status"
          isFetching={view.isFetching}
          isError={view.isError}
          syncedAt={view.syncedAt}
        />
      </header>

      {body}

      <Diary />

      <Link className="profile-settings" to="/settings" data-testid="link-settings">
        <span className="profile-settings__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
            <path
              d="M12 2.5v2.2M12 19.3v2.2M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="profile-settings__text">
          <span className="profile-settings__title">Settings &amp; connections</span>
          <span className="profile-settings__sub">
            Appearance, preferences, and your Trakt connection
          </span>
        </span>
        <svg
          className="profile-settings__chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </section>
  );
}
