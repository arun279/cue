import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { RootLayout } from "@ui/app-shell/RootLayout";

const rootRoute = createRootRoute({ component: RootLayout });

const upNextRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" }).lazy(() =>
  import("@app/routes/up-next.lazy").then((module) => module.Route),
);
const calendarRoute = createRoute({ getParentRoute: () => rootRoute, path: "/calendar" }).lazy(() =>
  import("@app/routes/calendar.lazy").then((module) => module.Route),
);
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
}).lazy(() => import("@app/routes/library.lazy").then((module) => module.Route));
const searchRoute = createRoute({ getParentRoute: () => rootRoute, path: "/search" }).lazy(() =>
  import("@app/routes/search.lazy").then((module) => module.Route),
);

// The three inner tabs were renamed (Upcoming→Calendar, My Shows→Library,
// Discover→Search); these non-lazy redirect routes keep every legacy
// bookmark and deep link working by throwing to the new path before load.
const upcomingRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: "/upcoming",
  beforeLoad: () => {
    throw redirect({ to: "/calendar" });
  },
});
const myShowsRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: "/my-shows",
  beforeLoad: () => {
    throw redirect({ to: "/library" });
  },
});
const discoverRedirect = createRoute({
  getParentRoute: () => rootRoute,
  path: "/discover",
  beforeLoad: () => {
    throw redirect({ to: "/search" });
  },
});

const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: "/profile" }).lazy(() =>
  import("@app/routes/profile.lazy").then((module) => module.Route),
);
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
}).lazy(() => import("@app/routes/show.lazy").then((module) => module.Route));
const movieRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/movie/$movieId",
}).lazy(() => import("@app/routes/movie.lazy").then((module) => module.Route));
const episodeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/show/$showId/episode/$season/$episode",
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
