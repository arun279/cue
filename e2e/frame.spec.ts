import { expect, test } from "@playwright/test";
import { installHermeticRoutes } from "./helpers";

test.beforeEach(async ({ page }) => {
  await installHermeticRoutes(page.context());
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

test("all five destinations plus /auth/callback are reachable", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");

  await expect(page.getByTestId("screen-up-next")).toBeVisible();

  for (const [label, testId] of [
    ["Upcoming", "screen-upcoming"],
    ["My Shows", "screen-my-shows"],
    ["Discover", "screen-discover"],
    ["Profile", "screen-profile"],
    ["Up Next", "screen-up-next"],
  ] as const) {
    await sidebar.getByRole("link", { name: label }).click();
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  await page.goto("/auth/callback");
  await expect(page.getByTestId("screen-auth-callback")).toBeVisible();
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

test("virtualizes the library list so DOM node count stays bounded", async ({ page }) => {
  await page.goto("/my-shows");
  await expect(page.getByTestId("virtual-list")).toBeVisible();

  const rows = page.getByTestId("virtual-row");
  await expect(rows.first()).toBeVisible();
  // 1000 items are backing the list; only the visible window is in the DOM.
  expect(await rows.count()).toBeLessThan(60);
});

test("catches a thrown render error in the boundary instead of blanking", async ({ page }) => {
  await page.goto("/?crash=1");
  await expect(page.getByTestId("error-boundary")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Something went wrong");
});

test("theme honors prefers-color-scheme and persists the toggle choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.locator('[data-testid="theme-toggle"]:visible').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  // The stored choice wins over the dark system preference after reload.
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
