import { expect, test } from "@playwright/test";
import {
  gateReadsUntilRefreshed,
  installHermeticRoutes,
  installOAuthRoutes,
  readStored,
  seedAuth,
} from "./helpers";

const CLIENT_ID = "a".repeat(64);

test.describe("token auto-refresh", () => {
  test("a live 401 on a sync read triggers exactly one refresh and a successful retry", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await seedAuth(page.context());
    // The first Up Next read 401s on the stale token, then succeeds on retry.
    await gateReadsUntilRefreshed(page.context(), ["**/api.trakt.tv/sync/watched/shows*"]);

    await page.goto("/");

    // Wait for the settled queue (not the loading shell): the gated read's retry
    // landed with the rotated token and Up Next resolved: no sign-out.
    await expect(page.getByTestId("empty-nothing-tracked")).toBeVisible();

    // Exactly one refresh, carrying the PKCE refresh grant with the seeded refresh
    // token and client id: and no client secret ever leaves the browser.
    const tokenRequests = oauth.getTokenRequests();
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "seed-refresh",
      client_id: CLIENT_ID,
    });
    expect(tokenRequests[0]).not.toHaveProperty("client_secret");

    // The rotated token was persisted so it survives a reload.
    const stored = await readStored(page, "cue.trakt.token");
    expect(JSON.parse(stored ?? "null")).toMatchObject({ access_token: "connected-access" });
  });

  test("two concurrent 401s share ONE refresh (single-flight)", async ({ page }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await seedAuth(page.context());
    // watched/shows succeeds on the stale token; the hidden + watchlist reads Up
    // Next fires concurrently next both 401 → they must share one refresh.
    await gateReadsUntilRefreshed(page.context(), [
      "**/api.trakt.tv/users/hidden/progress_watched*",
      "**/api.trakt.tv/sync/watchlist/shows*",
    ]);

    await page.goto("/");

    // The settled empty state only renders once BOTH concurrent reads resolved
    // (each via the shared refresh), so the count below is stable when asserted.
    await expect(page.getByTestId("empty-nothing-tracked")).toBeVisible();
    // Two concurrent 401s collapsed into a single /oauth/token exchange.
    expect(oauth.getTokenRequests()).toHaveLength(1);
  });

  test("a dead refresh token clears the session and shows onboarding", async ({ page }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    oauth.setTokenStatus(401); // invalid_grant: the refresh token itself is dead
    await seedAuth(page.context());
    await gateReadsUntilRefreshed(page.context(), ["**/api.trakt.tv/sync/watched/shows*"]);

    await page.goto("/");

    // The failed refresh tears the session down and routes back to onboarding.
    await expect(page.getByTestId("screen-onboarding")).toBeVisible();
    // Local auth is genuinely gone from IndexedDB: not merely hidden in memory.
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
  });
});
