import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  installHermeticRoutes,
  installHistoryRoutes,
  installLibraryRoutes,
  installMovieRoutes,
  installOAuthRoutes,
  type MovieFixture,
  type ShowFixture,
  seedAuth,
  seedTutorialDismissed,
} from "./helpers";

const MIN_CONTROL_FONT_SIZE = 16;
// Deliberately wider than the floor in `src/ui/styles/base.css`, which covers the three form
// elements and stops there. `contenteditable` is an attribute that can land on any element, so a
// stylesheet rule would silently clamp the typography of a future rich-text surface. The app has
// none today; if one arrives, this gate should fail loudly and let a human pick its type size.
const CONTROL_SELECTOR = "input, textarea, select, [contenteditable]";
const VIEWPORT_CONTENT = "width=device-width, initial-scale=1, viewport-fit=cover";

interface RouteAudit {
  readonly routerPath: string;
  readonly href: string;
  readonly screenTestId: string;
  readonly reveal?: "history-search" | "library-filter";
}

const ROUTES = [
  { routerPath: "/", href: "/", screenTestId: "screen-up-next" },
  { routerPath: "/calendar", href: "/calendar", screenTestId: "screen-calendar" },
  {
    routerPath: "/library",
    href: "/library",
    screenTestId: "screen-library",
    reveal: "library-filter",
  },
  { routerPath: "/search", href: "/search", screenTestId: "screen-search" },
  { routerPath: "/upcoming", href: "/upcoming", screenTestId: "screen-calendar" },
  {
    routerPath: "/my-shows",
    href: "/my-shows",
    screenTestId: "screen-library",
    reveal: "library-filter",
  },
  { routerPath: "/discover", href: "/discover", screenTestId: "screen-search" },
  { routerPath: "/profile", href: "/profile", screenTestId: "screen-profile" },
  {
    routerPath: "/history",
    href: "/history",
    screenTestId: "screen-history",
    reveal: "history-search",
  },
  {
    routerPath: "/auth/callback",
    href: "/auth/callback",
    screenTestId: "screen-auth-callback",
  },
  { routerPath: "/settings", href: "/settings", screenTestId: "screen-settings" },
  { routerPath: "/show/$showId", href: "/show/1", screenTestId: "screen-show-detail" },
  { routerPath: "/movie/$movieId", href: "/movie/100", screenTestId: "screen-movie-detail" },
  {
    routerPath: "episode/$season/$episode",
    href: "/show/1/episode/1/1",
    screenTestId: "episode-sheet",
  },
] as const satisfies readonly RouteAudit[];

const SHOW: ShowFixture = {
  trakt: 1,
  tmdb: 500,
  title: "Fixture Show",
  status: "returning series",
  posters: ["media.trakt.tv/show.webp"],
  lastWatchedAt: "2026-01-02T00:00:00.000Z",
  aired: 2,
  completed: 1,
  episodes: [
    {
      season: 1,
      number: 1,
      title: "Pilot",
      firstAired: "2026-01-01T00:00:00.000Z",
      traktId: 11,
    },
    {
      season: 1,
      number: 2,
      title: "Second",
      firstAired: "2026-01-08T00:00:00.000Z",
      traktId: 12,
    },
  ],
};

const MOVIE: MovieFixture = {
  trakt: 100,
  tmdb: 600,
  title: "Fixture Movie",
  year: 2026,
  posters: ["media.trakt.tv/movie.webp"],
  watched: false,
  inWatchlist: true,
};

function extractRouterPaths(source: string): string[] {
  return [
    ...source.matchAll(/\bpath:\s*"([^"]+)"/g),
    ...source.matchAll(/\blegacyRedirect\(\s*"([^"]+)"/g),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** Every text control the page currently renders must compute to 16px or larger:
 * anything smaller re-arms the iOS focus zoom the viewport meta cannot undo. */
async function expectNoZoomingControls(page: Page, label: string): Promise<void> {
  const controls = await page.locator(CONTROL_SELECTOR).evaluateAll((elements) =>
    elements.map((element) => {
      const testId = element.getAttribute("data-testid");
      const selector = `${element.tagName.toLowerCase()}${
        element.id === "" ? "" : `#${element.id}`
      }${[...element.classList].map((name) => `.${name}`).join("")}${
        testId === null ? "" : `[data-testid="${testId}"]`
      }`;
      return {
        selector,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      };
    }),
  );

  for (const control of controls) {
    expect(
      control.fontSize,
      `${label}: ${control.selector} computed font-size is ${control.fontSize}px`,
    ).toBeGreaterThanOrEqual(MIN_CONTROL_FONT_SIZE);
  }
}

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  await seedTutorialDismissed(page.context());
  await installLibraryRoutes(page.context(), [SHOW]);
  await installMovieRoutes(page.context(), [MOVIE]);
  await installHistoryRoutes(page.context(), []);
});

test("route audit covers every path declared by the router", () => {
  const routerSource = readFileSync(new URL("../src/app/router.tsx", import.meta.url), "utf8");
  const declaredPaths = [...new Set(extractRouterPaths(routerSource))].sort();
  const auditedPaths = [...new Set(ROUTES.map((route) => route.routerPath))].sort();

  expect(auditedPaths).toEqual(declaredPaths);
});

test("viewport meta preserves user zoom", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", VIEWPORT_CONTENT);
});

for (const route of ROUTES) {
  test(`${route.routerPath} keeps text controls at 16px or larger`, async ({ page }) => {
    await seedAuth(page.context());
    await page.goto(route.href);
    await expect(page.getByTestId(route.screenTestId)).toBeVisible();

    if ("reveal" in route && route.reveal === "library-filter") {
      await page.getByTestId("library-filter-toggle").click();
      await expect(page.getByTestId("library-filter")).toBeVisible();
    }
    if ("reveal" in route && route.reveal === "history-search") {
      await page.getByTestId("history-search-toggle").click();
      await expect(page.getByTestId("history-search-field")).toBeVisible();
    }

    await expectNoZoomingControls(page, route.href);
  });
}

// The signed-out surface renders before any route audit can reach it, so it is
// walked here as its own phase: connect, the device-code wait, and the error the
// declined poll returns to.
test("signed out screens keep text controls at 16px or larger", async ({ page }) => {
  const oauth = await installOAuthRoutes(page.context());
  oauth.setDeviceOutcome("denied");
  await page.goto("/");

  await expect(page.getByTestId("screen-onboarding")).toBeVisible();
  await expectNoZoomingControls(page, "onboarding");

  await page.getByTestId("button-device-code").click();
  await expect(page.getByTestId("device-user-code")).toHaveText("CUE-1234");
  await expectNoZoomingControls(page, "onboarding device code");

  await expect(page.getByTestId("connect-error")).toContainText("declined");
  await expectNoZoomingControls(page, "onboarding connect error");
});
