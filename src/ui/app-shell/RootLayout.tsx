import { Link, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "@ui/app-shell/ErrorBoundary";
import { navFor } from "@ui/app-shell/nav";
import { AppSnackbar } from "@ui/components/AppSnackbar";
import { useActivitiesPoll } from "@ui/hooks/useActivitiesPoll";
import { usePrefs } from "@ui/prefs/prefs-store";
import { CircleUserRound, Settings } from "lucide-react";
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

/**
 * Re-tapping the already-active tab scrolls its surface back to the top: the
 * bottom-nav contract users carry between apps. Long lists
 * (History, Calendar) own an inner scroll region, so the window alone would not
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

/** The tab destinations, styled by their bar. Test ids ride only the tab bar
 * so each `tab-*` selector resolves to a single element. */
function NavLinks({ variant }: { readonly variant: "tabbar" | "sidebar" }): ReactNode {
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const className = variant === "tabbar" ? "tabbar__item" : "sidebar__link";
  return navFor({ showsEnabled }).map((destination) => (
    <Link
      key={destination.path}
      to={destination.path}
      className={className}
      activeProps={{ className: `${className} ${className}--active`, "aria-current": "page" }}
      activeOptions={{ exact: true }}
      {...(variant === "tabbar" ? { "data-testid": destination.testId } : {})}
      onClick={() => {
        if (globalThis.location.pathname === destination.path) scrollActiveSurfaceToTop();
      }}
    >
      <destination.icon aria-hidden="true" />
      <span>{destination.label}</span>
    </Link>
  ));
}

/** Profile + Settings as labelled sidebar rows; on the phone the same pair
 * lives behind each screen header's avatar. */
function SidebarFooter(): ReactElement {
  return (
    <div className="sidebar__footer">
      <Link
        to="/profile"
        className="sidebar__link"
        activeProps={{ className: "sidebar__link sidebar__link--active", "aria-current": "page" }}
      >
        <CircleUserRound aria-hidden="true" />
        <span>Profile</span>
      </Link>
      <Link
        to="/settings"
        className="sidebar__link"
        activeProps={{ className: "sidebar__link sidebar__link--active", "aria-current": "page" }}
      >
        <Settings aria-hidden="true" />
        <span>Settings</span>
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
        <div className="sidebar__links">
          <NavLinks variant="sidebar" />
        </div>
        <SidebarFooter />
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        <ErrorBoundary>
          <CrashOnParam />
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav className="tabbar" aria-label="Primary">
        <NavLinks variant="tabbar" />
      </nav>

      <AppSnackbar />
    </div>
  );
}
