import type { UserStats } from "@data/trakt/schemas";
import { humanizeWatchMinutes } from "@domain/time";
import { Link } from "@tanstack/react-router";
import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { EmptyState } from "@ui/components/EmptyState";
import { ErrorRetry } from "@ui/components/ErrorStates";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { useStats } from "@ui/hooks/useStats";
import type { MediaVisibility } from "@ui/prefs/media-visibility";
import { usePrefs } from "@ui/prefs/prefs-store";
import { SignOutRow } from "@ui/screens/settings/SignOutRow";
import {
  ChevronRight,
  CircleUserRound,
  History as HistoryGlyph,
  Settings as SettingsGlyph,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { countTiles, isAllZero, watchTimeMinutes } from "./stats";

const COUNT = new Intl.NumberFormat("en-US");

function StatsBlock({
  stats,
  visibility,
}: {
  readonly stats: UserStats;
  readonly visibility: MediaVisibility;
}): ReactElement {
  const time = humanizeWatchMinutes(watchTimeMinutes(stats, visibility));
  return (
    <div className="you-stats" data-testid="stat-theatre">
      <article className="stat-hero" data-testid="stat-time">
        <p className="stat-hero__eyebrow">Total watch time</p>
        <p className="stat-hero__figure">
          <span className="stat-hero__value">{time.value}</span>
          <span className="stat-hero__unit">{time.unit}</span>
        </p>
        <p className="stat-hero__detail">{time.detail}</p>
      </article>
      <div className="stat-trio">
        {countTiles(stats, visibility).map((tile) => (
          <article key={tile.key} className="stat-cell" data-testid={tile.testId}>
            <p className="stat-cell__value">{COUNT.format(tile.value)}</p>
            <p className="stat-cell__label">{tile.label}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

const SKELETON_CELLS = [0, 1, 2];

function Skeleton(): ReactElement {
  return (
    <div className="you-stats" aria-hidden="true" data-testid="profile-skeleton">
      <div className="stat-hero stat-hero--skeleton" />
      <div className="stat-trio">
        {SKELETON_CELLS.map((cell) => (
          <div key={cell} className="stat-cell stat-cell--skeleton" />
        ))}
      </div>
    </div>
  );
}

/**
 * Profile ("You"): a short hub. Who is signed in, the lifetime totals from
 * `/users/me/stats` (one featured watch-time figure over the Episodes / Movies /
 * Shows trio), two bounded nav rows into History and Settings, and Sign out.
 * Keeping the unbounded log off this screen means Settings stays a tap away
 * rather than beneath a decade-deep scroll. Trakt exposes no avatar or username
 * through the reads Cue performs, so the identity row states the connection
 * plainly instead of pretending to a name it doesn't have.
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
      <EmptyState
        testId="profile-empty"
        headline="Nothing tallied yet."
        body="Mark an episode or movie watched and your watch time adds up here."
      >
        <Link className="button" to="/search" data-testid="profile-empty-discover">
          Find something to watch
        </Link>
      </EmptyState>
    );
  } else {
    body = <StatsBlock stats={view.stats} visibility={visibility} />;
  }

  return (
    <section className="screen-you" data-testid="screen-profile">
      <ScreenHeader title="You" variant="child" />
      <SyncStrip isError={view.isError} onRetry={view.refetch} />

      <div className="you-identity" data-testid="profile-identity">
        <span className="you-identity__avatar" aria-hidden="true">
          <CircleUserRound />
        </span>
        <span className="you-identity__text">
          <span className="you-identity__name">Trakt account</span>
          <span className="you-identity__sub" data-testid="connection-status">
            Connected
          </span>
        </span>
      </div>

      {body}

      <nav className="you-nav" aria-label="Profile">
        <Link className="you-row" to="/history" data-testid="link-history">
          <HistoryGlyph className="you-row__icon" aria-hidden="true" />
          <span className="you-row__label">History</span>
          <ChevronRight className="you-row__chevron" aria-hidden="true" />
        </Link>
        <Link className="you-row" to="/settings" data-testid="link-settings">
          <SettingsGlyph className="you-row__icon" aria-hidden="true" />
          <span className="you-row__label">Settings</span>
          <ChevronRight className="you-row__chevron" aria-hidden="true" />
        </Link>
      </nav>

      <SignOutRow />
    </section>
  );
}
