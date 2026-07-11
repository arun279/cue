import type { UserStats } from "@data/trakt/schemas";
import { humanizeWatchMinutes } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { SyncStatusPill } from "@ui/components/SyncStatusPill";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useStats } from "@ui/hooks/useStats";
import type { MediaVisibility } from "@ui/prefs/media-visibility";
import { usePrefs } from "@ui/prefs/prefs-store";
import type { ReactElement, ReactNode } from "react";

const COUNT = new Intl.NumberFormat("en-US");

interface CountTile {
  readonly key: string;
  readonly testId: string;
  readonly label: string;
  readonly value: number;
  readonly medium: "tv" | "movies";
}

/** The count tiles for the enabled media, in the canonical order (Episodes /
 * Movies / Shows). A single-medium user sees only their medium's tiles;
 * the honesty rule is that watch-time and tiles move together: never a Movies tile
 * hidden while its minutes still swell the total (or vice-versa). */
function countTiles(
  stats: UserStats,
  { showsEnabled, moviesEnabled }: MediaVisibility,
): CountTile[] {
  const tiles: CountTile[] = [
    {
      key: "episodes",
      testId: "stat-episodes",
      label: "Episodes",
      value: stats.episodes.watched,
      medium: "tv",
    },
    {
      key: "movies",
      testId: "stat-movies",
      label: "Movies",
      value: stats.movies.watched,
      medium: "movies",
    },
    {
      key: "shows",
      testId: "stat-shows",
      label: "Shows",
      value: stats.shows.watched,
      medium: "tv",
    },
  ];
  return tiles.filter((tile) => (tile.medium === "movies" ? moviesEnabled : showsEnabled));
}

/** Empty over the enabled media only: a movies-only user with zero movies gets the
 * empty state even if they have (now-hidden) TV history, and vice-versa. */
function isAllZero(stats: UserStats, { showsEnabled, moviesEnabled }: MediaVisibility): boolean {
  const tvZero = stats.episodes.watched === 0 && stats.shows.watched === 0;
  const moviesZero = stats.movies.watched === 0;
  return (!showsEnabled || tvZero) && (!moviesEnabled || moviesZero);
}

function Theatre({
  stats,
  visibility,
}: {
  readonly stats: UserStats;
  readonly visibility: MediaVisibility;
}): ReactElement {
  // Total watch time counts only the enabled media, so the hero figure and the
  // tiles below it always describe the same thing.
  const minutes =
    (visibility.showsEnabled ? stats.episodes.minutes : 0) +
    (visibility.moviesEnabled ? stats.movies.minutes : 0);
  const time = humanizeWatchMinutes(minutes);
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
        {countTiles(stats, visibility).map((tile) => (
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

function HistoryIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3.05 11a9 9 0 1 1 .5 4M3 11V6m0 5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7.5V12l3 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon(): ReactElement {
  return (
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
  );
}

/** A tappable Profile hub row, icon well, title/subtitle, chevron, that navigates
 * into a bounded destination (the watch history log, Settings). Keeping these as
 * short labelled rows means Settings is never trapped below an unbounded scroll. */
function HubCard({
  to,
  testId,
  icon,
  title,
  sub,
}: {
  readonly to: "/history" | "/settings";
  readonly testId: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly sub: string;
}): ReactElement {
  return (
    <Link className="profile-hub" to={to} data-testid={testId}>
      <span className="profile-hub__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="profile-hub__text">
        <span className="profile-hub__title">{title}</span>
        <span className="profile-hub__sub">{sub}</span>
      </span>
      <svg
        className="profile-hub__chevron"
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
  );
}

/**
 * Profile: a short hub. The signed-in user's lifetime totals from
 * `/users/me/stats` in the display face: one featured watch-time figure over a
 * triad of Episodes / Movies / Shows counts: crown two bounded hub rows: into the
 * full watch history (Cue's past tense and durable reversal home, now its own
 * `/history` route) and into Settings & connections. Keeping the unbounded log off
 * this screen means Settings stays a tap away at the top rather than beneath a
 * decade-deep scroll. Every stats state is designed: skeleton, hard error with
 * retry, and a brand-new-account (all-zero) empty state.
 */
export function Profile(): ReactElement {
  useDocumentTitle("Profile · Cue");
  const view = useStats();
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  const visibility: MediaVisibility = { showsEnabled, moviesEnabled };

  let body: ReactNode;
  if (view.isLoading) {
    body = <Skeleton />;
  } else if (view.isError && !view.hasData) {
    body = (
      <ErrorRetry
        title="Couldn't load your stats"
        testId="profile-error"
        buttonTestId="profile-error-retry"
        onRetry={view.refetch}
      />
    );
  } else if (view.stats === undefined || isAllZero(view.stats, visibility)) {
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
    body = <Theatre stats={view.stats} visibility={visibility} />;
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

      <nav className="profile-hubs" aria-label="Profile">
        <HubCard
          to="/history"
          testId="link-history"
          icon={<HistoryIcon />}
          title="Watch history"
          sub="Your reverse-chronological record: jump to any year or month"
        />
        <HubCard
          to="/settings"
          testId="link-settings"
          icon={<GearIcon />}
          title="Settings & connections"
          sub="Appearance, preferences, and your Trakt connection"
        />
      </nav>
    </section>
  );
}
