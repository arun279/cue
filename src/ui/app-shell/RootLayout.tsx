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
 * use: the param is never set by the app.
 */
function CrashOnParam(): ReactElement | null {
  if (new URLSearchParams(globalThis.location.search).get("crash") === "1") {
    throw new Error("Deliberate render crash (crash=1)");
  }
  return null;
}

/** The wordmark links home (= Up Next), honoring the universal logo→home
 * convention. The mark is decorative: the adjacent "Cue" text names the link. */
function Brand(): ReactElement {
  return (
    <Link to="/" className="brand" aria-label="Cue home">
      <CueMark className="brand__mark" />
      Cue
    </Link>
  );
}

/**
 * Re-tapping the already-active tab scrolls its surface back to the top: the
 * bottom-nav contract users carry between apps. Long lists
 * (History, Upcoming) own an inner scroll region, so the window alone would not
 * move; reset any announced [data-scroll-region] too. `prefers-reduced-motion` is
 * honored in JS (instant), since `scrollTo({behavior})` ignores the CSS clamp.
 */
function scrollActiveSurfaceToTop(): void {
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
  globalThis.scrollTo({ top: 0, behavior });
  for (const region of document.querySelectorAll<HTMLElement>("[data-scroll-region]")) {
    region.scrollTo({ top: 0, behavior });
  }
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
      onClick={() => {
        if (globalThis.location.pathname === destination.path) scrollActiveSurfaceToTop();
      }}
    >
      <NavIcon icon={destination.icon} />
      <span className="nav__text">{destination.label}</span>
    </Link>
  ));
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

/** The header avatar: the utility hub entry. Profile + Settings are not
 * among the four jobs, so they left the tab bar; this small round affordance opens
 * the Profile hub, from which Settings and the Trakt connection are one tap. */
function Avatar(): ReactElement {
  return (
    <Link to="/profile" className="topbar__avatar" aria-label="Profile">
      <ProfileIcon />
    </Link>
  );
}

/** The utility affordances as labelled rows in the sidebar footer, where the wider
 * desktop chrome has room for text beside the icons. Discover is a primary tab now,
 * so the footer carries only Profile + Settings. */
function SidebarFooter(): ReactElement {
  return (
    <div className="sidebar__footer">
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
          <Avatar />
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
