import { Link, Outlet } from "@tanstack/react-router";
import { CueMark } from "@ui/app-shell/CueMark";
import { ErrorBoundary } from "@ui/app-shell/ErrorBoundary";
import { NavIcon } from "@ui/app-shell/NavIcon";
import { navFor } from "@ui/app-shell/nav";
import { NavGlyph } from "@ui/components/NavGlyph";
import { useActivitiesPoll } from "@ui/hooks/useActivitiesPoll";
import { usePrefs } from "@ui/prefs/prefs-store";
import type { ReactElement, ReactNode } from "react";

/**
 * Test-only seam: `?crash=1` throws during render so
 * the hermetic suite can prove the error boundary catches it. Harmless in normal
 * use — the param is never set by the app.
 */
function CrashOnParam(): ReactElement | null {
  if (new URLSearchParams(globalThis.location.search).get("crash") === "1") {
    throw new Error("Deliberate render crash (crash=1)");
  }
  return null;
}

/** The wordmark links home (= Up Next), honoring the universal logo→home
 * convention. The mark is decorative — the adjacent "Cue" text names the link. */
function Brand(): ReactElement {
  return (
    <Link to="/" className="brand" aria-label="Cue home">
      <CueMark className="brand__mark" />
      Cue
    </Link>
  );
}

/** The Search affordance's accessible name, derived from the active media the same
 * way the Search screen labels its field — so a single-medium user never reads
 * "shows and movies" for a search that only spans their one medium. */
function searchLabel(showsEnabled: boolean, moviesEnabled: boolean): string {
  const noun =
    showsEnabled && moviesEnabled ? "shows and movies" : showsEnabled ? "shows" : "movies";
  return `Search ${noun}`;
}

function NavLinks(): ReactNode {
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  return navFor({ showsEnabled }).map((destination) => (
    <Link
      key={destination.path}
      to={destination.path}
      className="nav__link"
      activeProps={{ className: "nav__link nav__link--active", "aria-current": "page" }}
      activeOptions={{ exact: true }}
    >
      <NavIcon icon={destination.icon} />
      <span className="nav__text">{destination.label}</span>
    </Link>
  ));
}

function SearchIcon(): ReactElement {
  return (
    <NavGlyph>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </NavGlyph>
  );
}

function ProfileIcon(): ReactElement {
  return (
    <NavGlyph>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </NavGlyph>
  );
}

function SettingsIcon(): ReactElement {
  return (
    <NavGlyph>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </NavGlyph>
  );
}

/** The header Search + Profile affordances — persistent, non-tab controls reachable
 * from every screen (Search moved off the bottom bar to a header search; Profile to
 * a corner/account control). Icon-only in the topbar cluster to stay quiet. */
function TopbarActions(): ReactElement {
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  return (
    <div className="topbar__actions">
      <Link
        to="/search"
        className="topbar__action"
        aria-label={searchLabel(showsEnabled, moviesEnabled)}
      >
        <SearchIcon />
      </Link>
      <Link to="/profile" className="topbar__action" aria-label="Profile">
        <ProfileIcon />
      </Link>
    </div>
  );
}

/** The same Search / Profile / Settings affordances as labelled rows in the sidebar
 * footer, where the wider desktop chrome has room for text beside the icons. */
function SidebarFooter(): ReactElement {
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  return (
    <div className="sidebar__footer">
      <Link
        to="/search"
        className="nav__link"
        aria-label={searchLabel(showsEnabled, moviesEnabled)}
        activeProps={{ className: "nav__link nav__link--active", "aria-current": "page" }}
      >
        <SearchIcon />
        <span className="nav__text">Search</span>
      </Link>
      <Link
        to="/profile"
        className="nav__link"
        activeProps={{ className: "nav__link nav__link--active", "aria-current": "page" }}
      >
        <ProfileIcon />
        <span className="nav__text">Profile</span>
      </Link>
      <Link
        to="/settings"
        className="nav__link"
        activeProps={{ className: "nav__link nav__link--active", "aria-current": "page" }}
      >
        <SettingsIcon />
        <span className="nav__text">Settings</span>
      </Link>
    </div>
  );
}

export function RootLayout(): ReactElement {
  // The one freshness gate: a visibility-gated last_activities poll invalidates
  // exactly what changed. Navigation itself never refetches. It
  // no-ops until a session runtime exists (e.g. the pre-token /auth/callback render
  // renders this shell without a RuntimeProvider).
  useActivitiesPoll();
  return (
    <div className="layout">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Primary">
        <Brand />
        <div className="sidebar__links">
          <NavLinks />
        </div>
        <SidebarFooter />
      </nav>

      <div className="content">
        <header className="topbar">
          <Brand />
          <TopbarActions />
        </header>
        <main id="main" className="main" tabIndex={-1}>
          <ErrorBoundary>
            <CrashOnParam />
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav className="tabbar" aria-label="Primary">
        <NavLinks />
      </nav>
    </div>
  );
}
