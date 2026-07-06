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

  await expect(page).toHaveTitle("Cue");
  await expect(page.getByTestId("screen-up-next")).toBeVisible();
  expect(errors).toEqual([]);
});

test("exactly three tabs plus Search and Profile as non-tab affordances", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");

  await expect(page.getByTestId("screen-up-next")).toBeVisible();

  // Exactly three primary destinations — Search and Profile are NOT tabs.
  await expect(sidebar.locator(".sidebar__links a")).toHaveCount(3);

  for (const [label, testId] of [
    ["Calendar", "screen-calendar"],
    ["Library", "screen-library"],
    ["Up Next", "screen-up-next"],
  ] as const) {
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  // Search + Profile are reachable non-tab affordances that navigate to their routes.
  await sidebar.getByRole("link", { name: "Search shows and movies" }).click();
  await expect(page.getByTestId("screen-search")).toBeVisible();
  await expect(page).toHaveURL(/\/search$/);

  await sidebar.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByTestId("screen-profile")).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);

  await page.goto("/auth/callback");
  await expect(page.getByTestId("screen-auth-callback")).toBeVisible();
});

test("legacy /my-shows deep link redirects to /library", async ({ page }) => {
  await page.goto("/my-shows");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByTestId("screen-library")).toBeVisible();
});

test("renders a sidebar at 1280px and a bottom tab bar at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".tabbar")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".tabbar")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
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
