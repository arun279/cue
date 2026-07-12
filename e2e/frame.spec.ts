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

  const sidebar = page.locator(".sidebar");
  await sidebar.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveTitle("Library · Cue");

  await sidebar.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveTitle("Calendar · Cue");

  await sidebar.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page).toHaveTitle("Search · Cue");

  // History is a Profile child now, not a tab: deep link it.
  await page.goto("/history");
  await expect(page).toHaveTitle("History · Cue");

  await page.goto("/profile");
  await expect(page).toHaveTitle("Profile · Cue");

  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings · Cue");

  // The OAuth return names its purpose.
  await page.goto("/auth/callback");
  await expect(page).toHaveTitle("Connecting · Cue");
});

test("exactly four job tabs: Up Next, Library, Calendar, Search; History and Profile are not tabs", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");

  await expect(page.getByTestId("screen-up-next")).toBeVisible();

  // Exactly four primary destinations = the four jobs (§2.1). No fifth tab, ever.
  await expect(sidebar.locator(".sidebar__links a")).toHaveCount(4);

  for (const [label, screen] of [
    ["Library", "screen-library"],
    ["Calendar", "screen-calendar"],
    ["Search", "screen-search"],
    ["Up Next", "screen-up-next"],
  ] as const) {
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByTestId(screen)).toBeVisible();
  }

  // The Discover label is dead (the screen is honest "Search"), and History is
  // no longer a tab: it lives under Profile.
  await expect(sidebar.getByRole("link", { name: "Discover", exact: true })).toHaveCount(0);
  await expect(sidebar.locator(".sidebar__links a", { hasText: "History" })).toHaveCount(0);

  // Profile is a reachable non-tab utility hub; History is one tap inside it.
  await sidebar.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByTestId("link-history").click();
  await expect(page.getByTestId("screen-history")).toBeVisible();
  await expect(page).toHaveURL(/\/history$/);

  await page.goto("/auth/callback");
  await expect(page.getByTestId("screen-auth-callback")).toBeVisible();
});

test("the phone tab bar carries the four labeled tabs and the header avatar opens Profile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  // The four tab items, by stable id, all visible on the phone bar.
  for (const id of ["tab-up-next", "tab-library", "tab-calendar", "tab-search"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await page.getByTestId("tab-library").click();
  await expect(page.getByTestId("screen-library")).toBeVisible();
  await page.getByTestId("tab-calendar").click();
  await expect(page.getByTestId("screen-calendar")).toBeVisible();
  await page.getByTestId("tab-search").click();
  await expect(page.getByTestId("screen-search")).toBeVisible();
  await page.getByTestId("tab-up-next").click();
  await expect(page.getByTestId("screen-up-next")).toBeVisible();

  // The brand bar is gone; the root header carries the screen title + avatar.
  await expect(page.getByRole("link", { name: "Cue home" })).toHaveCount(0);
  await page.getByTestId("avatar-link").click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);
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

test("theme follows the OS under System, and an explicit choice persists", async ({ page }) => {
  // System is the default preference: a light OS scheme lands light…
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // …and a dark OS scheme re-stamps live, no reload.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // An explicit choice (Settings ▸ Appearance, System/Dark/Light segmented)
  // overrides the OS and persists across a reload.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("theme-toggle").getByText("Light", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
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
