import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { RootLayout } from "@ui/app-shell/RootLayout";

const rootRoute = createRootRoute({ component: RootLayout });

const upNextRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" }).lazy(() =>
  import("@app/routes/up-next.lazy").then((module) => module.Route),
);
const upcomingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/upcoming" }).lazy(() =>
  import("@app/routes/upcoming.lazy").then((module) => module.Route),
);
const myShowsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/my-shows" }).lazy(() =>
  import("@app/routes/my-shows.lazy").then((module) => module.Route),
);
const discoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/discover" }).lazy(() =>
  import("@app/routes/discover.lazy").then((module) => module.Route),
);
const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: "/profile" }).lazy(() =>
  import("@app/routes/profile.lazy").then((module) => module.Route),
);
const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
}).lazy(() => import("@app/routes/auth-callback.lazy").then((module) => module.Route));

const routeTree = rootRoute.addChildren([
  upNextRoute,
  upcomingRoute,
  myShowsRoute,
  discoverRoute,
  profileRoute,
  authCallbackRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
