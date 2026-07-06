import { Link, Outlet } from "@tanstack/react-router";
import { CueMark } from "@ui/app-shell/CueMark";
import { ErrorBoundary } from "@ui/app-shell/ErrorBoundary";
import { NavIcon } from "@ui/app-shell/NavIcon";
import { navDestinations } from "@ui/app-shell/nav";
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

function Brand(): ReactElement {
  return (
    <span className="brand">
      <CueMark className="brand__mark" />
      Cue
    </span>
  );
}

function NavLinks(): ReactNode {
  return navDestinations.map((destination) => (
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

function SettingsLink(): ReactElement {
  return (
    <Link
      to="/settings"
      className="nav__link"
      activeProps={{ className: "nav__link nav__link--active", "aria-current": "page" }}
    >
      <svg
        className="nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      <span className="nav__text">Settings</span>
    </Link>
  );
}

export function RootLayout(): ReactElement {
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
        <div className="sidebar__footer">
          <SettingsLink />
        </div>
      </nav>

      <div className="content">
        <header className="topbar">
          <Brand />
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
