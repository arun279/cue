import { expect, type Page, test } from "@playwright/test";
import { installHermeticRoutes, installOAuthRoutes, readStored, seedAuth } from "./helpers";

const CLIENT_ID = "a".repeat(64);
const CLIENT_SECRET = "b".repeat(64);

async function fillTraktCreds(page: Page, tmdbKey = ""): Promise<void> {
  await page.getByTestId("input-client-id").fill(CLIENT_ID);
  await page.getByTestId("input-client-secret").fill(CLIENT_SECRET);
  if (tmdbKey.length > 0) await page.getByTestId("input-tmdb-key").fill(tmdbKey);
}

test.describe("onboarding + auth", () => {
  test("shows the single-owner / secret-not-confidential onboarding copy", async ({ page }) => {
    await installHermeticRoutes(page.context());
    await page.goto("/");

    await expect(page.getByTestId("screen-onboarding")).toBeVisible();
    const copy = page.getByTestId("single-owner-copy");
    await expect(copy).toContainText("single-owner");
    await expect(copy).toContainText("stored on this device only");
    await expect(copy).toContainText("not treated as a confidential client secret");
  });

  test("format-checks Trakt creds before attempting a connect", async ({ page }) => {
    await installHermeticRoutes(page.context());
    await installOAuthRoutes(page.context());
    await page.goto("/");

    await page.getByTestId("input-client-id").fill("too-short");
    await page.getByTestId("button-connect").click();

    await expect(page.getByTestId("error-client-id")).toBeVisible();
    await expect(page.getByTestId("error-client-secret")).toBeVisible();
    // Still on onboarding — no redirect was issued.
    await expect(page.getByTestId("screen-onboarding")).toBeVisible();
  });

  test("validates the TMDB key standalone: a bad key is a field error, creds untouched", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    oauth.setTmdbValid(false);
    await page.goto("/");

    await fillTraktCreds(page, "bad-tmdb-key");
    await page.getByTestId("button-connect").click();

    await expect(page.getByTestId("error-tmdb-key")).toBeVisible();
    // Trakt creds are only format-checked — well-formed values raise no field error.
    await expect(page.getByTestId("error-client-id")).toHaveCount(0);
    await expect(page.getByTestId("error-client-secret")).toHaveCount(0);
    await expect(page.getByTestId("screen-onboarding")).toBeVisible();
  });

  test("web auth-code path: callback validates state, exchanges the code, stores the token, routes to Up Next", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await page.goto("/");

    // TMDB blank — proves Trakt-connected-with-TMDB-blank still completes.
    await fillTraktCreds(page);
    await page.getByTestId("button-connect").click();

    await expect(page.getByTestId("screen-up-next")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // A non-empty state nonce was generated and echoed through authorize.
    const state = oauth.getAuthorizeState();
    expect(state).not.toBeNull();
    expect((state ?? "").length).toBeGreaterThan(0);

    // Exactly one code→token exchange, carrying the auth-code grant + creds.
    const tokenRequests = oauth.getTokenRequests();
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toMatchObject({
      code: "good-code",
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    // The exchanged token was persisted for the authed session.
    const stored = await readStored(page, "cue.trakt.token");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "null")).toMatchObject({ access_token: "connected-access" });
  });

  test("web auth-code path: a mismatched state nonce is rejected with no token exchange or store", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    oauth.setStateEcho("mismatch");
    await page.goto("/");

    await fillTraktCreds(page);
    await page.getByTestId("button-connect").click();

    await expect(page.getByTestId("callback-error")).toBeVisible();
    await expect(page.getByTestId("screen-up-next")).toHaveCount(0);

    // A rejected state must short-circuit before any exchange and leave no token.
    expect(oauth.getTokenRequests()).toHaveLength(0);
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
  });

  test("mobile device-code path polls idle→connecting→success", async ({ page }) => {
    await installHermeticRoutes(page.context());
    await installOAuthRoutes(page.context());
    await page.goto("/");

    await fillTraktCreds(page);
    await page.getByTestId("button-device-code").click();

    // connecting: the user code is shown while the poll runs.
    await expect(page.getByTestId("device-user-code")).toHaveText("CUE-1234");
    // success: the second poll authorizes and routes to Up Next.
    await expect(page.getByTestId("screen-up-next")).toBeVisible({ timeout: 15_000 });
  });

  test("mobile device-code path surfaces a declined approval as a recoverable error", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    oauth.setDeviceOutcome("denied");
    await page.goto("/");

    await fillTraktCreds(page);
    await page.getByTestId("button-device-code").click();

    await expect(page.getByTestId("device-user-code")).toHaveText("CUE-1234");
    // The denied poll returns the user to the form with an actionable message.
    await expect(page.getByTestId("connect-error")).toContainText("declined");
    await expect(page.getByTestId("button-connect")).toBeVisible();
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
  });

  test("disconnect revokes the token, clears the persisted store, and returns to onboarding", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await seedAuth(page.context());
    await page.goto("/profile");

    await page.getByTestId("link-settings").click();
    await expect(page.getByTestId("screen-settings")).toBeVisible();
    await expect(page.getByTestId("connection-status")).toContainText("Connected");

    const revoke = page.waitForRequest("**/api.trakt.tv/oauth/revoke");
    await page.getByTestId("button-disconnect").click();
    await revoke;

    await expect(page.getByTestId("screen-onboarding")).toBeVisible();

    // The revoke carried the seeded token + client creds.
    expect(oauth.getRevokeRequests()).toHaveLength(1);
    expect(oauth.getRevokeRequests()[0]).toMatchObject({
      token: "seed-access",
      client_id: "a".repeat(64),
      client_secret: "b".repeat(64),
    });

    // Local auth is genuinely gone from IndexedDB — not merely hidden in memory.
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
    expect(await readStored(page, "cue.trakt.creds")).toBeNull();
  });
});
