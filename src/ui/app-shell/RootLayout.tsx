import { Link, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "@ui/app-shell/ErrorBoundary";
import { NavIcon } from "@ui/app-shell/NavIcon";
import { navDestinations } from "@ui/app-shell/nav";
import { ThemeToggle } from "@ui/theme/ThemeToggle";
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

export function RootLayout(): ReactElement {
  return (
    <div className="layout">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Primary">
        <span className="brand">Cue</span>
        <div className="sidebar__links">
          <NavLinks />
        </div>
        <div className="sidebar__footer">
          <ThemeToggle />
        </div>
      </nav>

      <div className="content">
        <header className="topbar">
          <span className="brand brand--compact">Cue</span>
          <ThemeToggle />
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
