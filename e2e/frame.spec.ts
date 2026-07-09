import { expect, test } from "@playwright/test";
import { installHermeticRoutes, seedAuth } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
  // The frame suite starts authenticated; the auth flow itself lives in auth.spec.
  await seedAuth(page.context());
});

test("mounts the frame with the document title and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page).toHaveTitle("Up Next · Cue");
  await expect(page.getByTestId("screen-up-next")).toBeVisible();
  expect(errors).toEqual([]);
});

test("each route sets a truthful, distinct document title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Up Next · Cue");

  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await expect(page).toHaveTitle("Library · Cue");

  await page.getByRole("link", { name: "History", exact: true }).first().click();
  await expect(page).toHaveTitle("Watch history · Cue");

  await page.getByRole("link", { name: "Discover", exact: true }).first().click();
  await expect(page).toHaveTitle("Discover · Cue");

  // Calendar demoted to an "Upcoming" view one tap inside Up Next (no longer a tab).
  await page.goto("/");
  await page.getByTestId("up-next-upcoming").click();
  await expect(page).toHaveTitle("Upcoming · Cue");

  await page.goto("/profile");
  await expect(page).toHaveTitle("Profile · Cue");

  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings · Cue");

  // Dynamic detail titles name the entity; the OAuth return names its purpose.
  await page.goto("/auth/callback");
  await expect(page).toHaveTitle("Connecting · Cue");
});

test("the brand wordmark is a link home with an accessible name", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("screen-profile")).toBeVisible();

  // The mark is not a dead <span>: it is a labelled link back to Up Next (home).
  const brand = page.getByRole("link", { name: "Cue home" }).first();
  await expect(brand).toBeVisible();
  await brand.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("screen-up-next")).toBeVisible();
});

test("exactly four job tabs; Calendar folds into Up Next, Profile is a header avatar", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");

  await expect(page.getByTestId("screen-up-next")).toBeVisible();

  // Exactly four primary destinations = the four jobs. Profile/Settings are NOT tabs.
  await expect(sidebar.locator(".sidebar__links a")).toHaveCount(4);

  for (const [label, testId] of [
    ["Library", "screen-library"],
    ["History", "screen-history"],
    ["Discover", "screen-search"],
    ["Up Next", "screen-up-next"],
  ] as const) {
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  // Calendar is demoted: not a tab, reachable one tap from Up Next as "Upcoming".
  await expect(sidebar.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
  await page.getByTestId("up-next-upcoming").click();
  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await expect(page).toHaveURL(/\/calendar$/);

  // Profile is a reachable non-tab utility hub (header avatar on mobile, footer row
  // on desktop); Settings lives one tap inside it.
  await page.goto("/");
  await sidebar.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);

  await page.goto("/auth/callback");
  await expect(page.getByTestId("screen-auth-callback")).toBeVisible();
});

// Every legacy tab path must still resolve so old bookmarks / deep links work.
for (const [legacy, target, screen] of [
  ["/upcoming", "/calendar", "screen-calendar"],
  ["/my-shows", "/library", "screen-library"],
  ["/discover", "/search", "screen-search"],
] as const) {
  test(`legacy ${legacy} deep link redirects to ${target}`, async ({ page }) => {
    await page.goto(legacy);
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(page.getByTestId(screen)).toBeVisible();
  });
}

test("renders a sidebar at 1280px and a bottom tab bar at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".tabbar")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".tabbar")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
});

test("scrollable content clears the fixed bottom tab bar at 390px (no occlusion)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByTestId("screen-settings")).toBeVisible();

  const result = await page.evaluate(() => {
    const main = document.querySelector(".main") as HTMLElement;
    const bar = document.querySelector(".tabbar") as HTMLElement;
    const pad = Number.parseFloat(getComputedStyle(main).paddingBottom);
    const barHeight = bar.getBoundingClientRect().height;
    window.scrollTo(0, document.body.scrollHeight);
    const controls = [
      ...document.querySelectorAll(
        '[data-testid="screen-settings"] button, [data-testid="screen-settings"] a,' +
          ' [data-testid="screen-settings"] input, [data-testid="screen-settings"] select',
      ),
    ];
    const maxBottom = Math.max(...controls.map((c) => c.getBoundingClientRect().bottom));
    return { pad, barHeight, barTop: bar.getBoundingClientRect().top, maxBottom };
  });

  // The scroll container reserves at least the bar's height, so the last row is
  // never trapped beneath it; and after scrolling to the very bottom, no control
  // crosses the bar's top edge.
  expect(result.pad).toBeGreaterThanOrEqual(result.barHeight);
  expect(result.maxBottom).toBeLessThanOrEqual(result.barTop + 1);
});

test("catches a thrown render error in the boundary instead of blanking", async ({ page }) => {
  await page.goto("/?crash=1");
  await expect(page.getByTestId("error-boundary")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Something went wrong");
});

test("defaults to the dark screening room and persists the toggle choice", async ({ page }) => {
  // Dark is Cue's unconditional default — even a light OS preference lands dark.
  await page.emulateMedia({ colorScheme: "light" });
  // The theme toggle now lives in Settings ▸ Appearance, not the header/sidebar.
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  // The stored choice wins over the dark default after reload.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("requests durable storage at first run", async ({ page }) => {
  await page.addInitScript(() => {
    const storage = navigator.storage as StorageManager & { persist?: () => Promise<boolean> };
    const original = storage.persist?.bind(storage);
    const flagged = window as unknown as { __persistRequested?: boolean };
    flagged.__persistRequested = false;
    storage.persist = () => {
      flagged.__persistRequested = true;
      return original ? original() : Promise.resolve(true);
    };
  });

  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __persistRequested?: boolean }).__persistRequested,
      ),
    )
    .toBe(true);
});
