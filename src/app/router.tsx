import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { RootLayout } from "@ui/app-shell/RootLayout";
import { usePrefs } from "@ui/prefs/prefs-store";

const rootRoute = createRootRoute({ component: RootLayout });

// Up Next, Calendar, and the show/episode detail pages are TV-centric surfaces; a
// movies-only app (TV disabled in Settings) routes their deep links home
// to the movies Library rather than paint a screen for a hidden medium. The nav
// already omits the tabs; this guards the URL — including stale show/episode links.
const requireShows = (): void => {
  if (!usePrefs.getState().showsEnabled) throw redirect({ to: "/library" });
};

const upNextRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: requireShows,
}).lazy(() => import("@app/routes/up-next.lazy").then((module) => module.Route));
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  beforeLoad: requireShows,
}).lazy(() => import("@app/routes/calendar.lazy").then((module) => module.Route));
/** Library view-state lives in the URL so it is deep-linkable and, crucially, so
 * browser history restores the tab you were on: Movies → movie detail → Back now
 * returns to Movies (previously it reset to Shows). Shows is the canonical default
 * carrying no param, so bare `/library`, legacy redirects, and every existing
 * `to="/library"` link stay valid and clean; only Movies pins `?type=movies`. */
interface LibrarySearch {
  readonly type?: "movies";
}
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library",
  validateSearch: (search: Record<string, unknown>): LibrarySearch =>
    search["type"] === "movies" ? { type: "movies" } : {},
  // A `?type=movies` deep link is meaningless once Movies are turned off; drop the
  // param so Library lands cleanly on Shows.
  beforeLoad: ({ search }) => {
    if (search.type === "movies" && !usePrefs.getState().moviesEnabled) {
      throw redirect({ to: "/library" });
    }
  },
}).lazy(() => import("@app/routes/library.lazy").then((module) => module.Route));
const searchRoute = createRoute({ getParentRoute: () => rootRoute, path: "/search" }).lazy(() =>
  import("@app/routes/search.lazy").then((module) => module.Route),
);

// The three inner tabs were renamed (Upcoming→Calendar, My Shows→Library,
// Discover→Search); these non-lazy redirect routes keep every legacy
// bookmark and deep link working by throwing to the new path before load.
const legacyRedirect = (path: string, to: "/calendar" | "/library" | "/search") =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      throw redirect({ to });
    },
  });
const upcomingRedirect = legacyRedirect("/upcoming", "/calendar");
const myShowsRedirect = legacyRedirect("/my-shows", "/library");
const discoverRedirect = legacyRedirect("/discover", "/search");

const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: "/profile" }).lazy(() =>
  import("@app/routes/profile.lazy").then((module) => module.Route),
);
/** The watch-history log lives in the URL so every scope is deep-linkable and
 * scroll-restorable: `?type` picks the medium (All is the default, carrying no
 * param), and `?year`/`?month` are the decade jump. `month` is only meaningful
 * inside a `year`, so it is dropped when no valid year is present. The year sanity
 * range is generous (a deep link to any real year works) — the picker's own floor
 * only shapes which years it offers as chips, never which the URL accepts. */
interface HistorySearch {
  readonly type?: "tv" | "movies";
  readonly year?: number;
  readonly month?: number;
}
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  validateSearch: (search: Record<string, unknown>): HistorySearch => {
    const out: { type?: "tv" | "movies"; year?: number; month?: number } = {};
    if (search["type"] === "tv" || search["type"] === "movies") out.type = search["type"];
    const year = Number(search["year"]);
    if (Number.isInteger(year) && year >= 1970 && year <= 2100) out.year = year;
    const month = Number(search["month"]);
    if (out.year !== undefined && Number.isInteger(month) && month >= 1 && month <= 12) {
      out.month = month;
    }
    return out;
  },
}).lazy(() => import("@app/routes/history.lazy").then((module) => module.Route));
const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
}).lazy(() => import("@app/routes/auth-callback.lazy").then((module) => module.Route));
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings" }).lazy(() =>
  import("@app/routes/settings.lazy").then((module) => module.Route),
);
const showRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/show/$showId",
  beforeLoad: requireShows,
}).lazy(() => import("@app/routes/show.lazy").then((module) => module.Route));
const movieRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/movie/$movieId",
}).lazy(() => import("@app/routes/movie.lazy").then((module) => module.Route));
const episodeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/show/$showId/episode/$season/$episode",
  beforeLoad: requireShows,
}).lazy(() => import("@app/routes/episode.lazy").then((module) => module.Route));

const routeTree = rootRoute.addChildren([
  upNextRoute,
  calendarRoute,
  libraryRoute,
  searchRoute,
  upcomingRedirect,
  myShowsRedirect,
  discoverRedirect,
  profileRoute,
  historyRoute,
  authCallbackRoute,
  settingsRoute,
  showRoute,
  movieRoute,
  episodeRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // Restore window scroll on back/forward so returning to a list (e.g. Library
  // Shows → detail → Back) lands where you left off instead of at the top.
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
