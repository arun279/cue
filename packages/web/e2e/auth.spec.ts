import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { installHermeticRoutes, installOAuthRoutes, readStored, seedAuth } from "./helpers";

// The public client id embedded at build time from .env.test (mirrors the app's
// VITE_TRAKT_CLIENT_ID). Every OAuth request must carry THIS id, never a
// user-entered one: users only sign into their own Trakt account.
const CLIENT_ID = "a".repeat(64);

/** base64url(SHA-256(verifier)): the S256 challenge a compliant client must derive. */
function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

test.describe("onboarding + auth", () => {
  test("first run is a single connect screen: no credential inputs to fill", async ({ page }) => {
    await installHermeticRoutes(page.context());
    await page.goto("/");

    await expect(page.getByTestId("screen-onboarding")).toBeVisible();
    // The welcome beat: wordmark + one line + the amber CTA + Trakt attribution.
    await expect(page.getByRole("heading", { name: "Cue" })).toBeVisible();
    await expect(page.getByText("Your shows. One tap ahead.")).toBeVisible();
    await expect(page.getByTestId("button-connect")).toHaveText("Connect Trakt");
    await expect(page.getByText("Powered by Trakt")).toBeVisible();

    // The whole developer-facing surface is gone: no client-id field, no
    // "add this redirect URI to your Trakt app" callout. A user never enters a
    // client id: it is embedded once by the app author.
    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.getByTestId("input-client-id")).toHaveCount(0);
    await expect(page.getByTestId("callback-url")).toHaveCount(0);
  });

  test("Connect Trakt redirects to a trakt.tv authorize URL carrying the embedded client id, then completes the exchange", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await page.goto("/");

    await page.getByTestId("button-connect").click();

    await expect(page.getByTestId("screen-up-next")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // The authorize redirect carried the build-time embedded public client id,
    // NOT anything the user typed (there is no input): plus a non-empty state.
    expect(oauth.getAuthorizeClientId()).toBe(CLIENT_ID);
    const state = oauth.getAuthorizeState();
    expect(state).not.toBeNull();
    expect((state ?? "").length).toBeGreaterThan(0);

    // The authorize redirect carried an S256 PKCE challenge (no secret leaves the browser).
    const { challenge, method } = oauth.getAuthorizeChallenge();
    expect(method).toBe("S256");
    expect((challenge ?? "").length).toBeGreaterThan(0);

    // Exactly one code→token exchange, carrying the auth-code grant + PKCE verifier, NO secret.
    const tokenRequests = oauth.getTokenRequests();
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toMatchObject({
      code: "good-code",
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
    });
    expect(tokenRequests[0]).not.toHaveProperty("client_secret");
    // The verifier the exchange proved matches the challenge the authorize step advertised.
    const verifier = tokenRequests[0]?.["code_verifier"] as string;
    expect(typeof verifier).toBe("string");
    expect(s256(verifier)).toBe(challenge);

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

    await page.getByTestId("button-connect").click();

    await expect(page.getByTestId("callback-error")).toBeVisible();
    await expect(page.getByTestId("screen-up-next")).toHaveCount(0);

    // A rejected state must short-circuit before any exchange and leave no token.
    expect(oauth.getTokenRequests()).toHaveLength(0);
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
  });

  test("device-code fallback polls idle→connecting→success", async ({ page }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await page.goto("/");

    await page.getByTestId("button-device-code").click();

    // connecting: the user code is shown while the poll runs.
    await expect(page.getByTestId("device-user-code")).toHaveText("CUE-1234");
    // success: the second poll authorizes and routes to Up Next.
    await expect(page.getByTestId("screen-up-next")).toBeVisible({ timeout: 15_000 });

    // The device-code request bound the flow with an S256 PKCE challenge, and the
    // poll proved the matching verifier: meaningful PKCE, no secret.
    const { challenge, method } = oauth.getDeviceChallenge();
    expect(method).toBe("S256");
    expect((challenge ?? "").length).toBeGreaterThan(0);
    const poll = oauth.getDeviceTokenRequests().at(-1);
    expect(poll).not.toHaveProperty("client_secret");
    expect(poll).toMatchObject({ client_id: CLIENT_ID });
    const verifier = poll?.["code_verifier"] as string;
    expect(typeof verifier).toBe("string");
    expect(s256(verifier)).toBe(challenge);
  });

  test("device-code fallback surfaces a declined approval as a recoverable error", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    oauth.setDeviceOutcome("denied");
    await page.goto("/");

    await page.getByTestId("button-device-code").click();

    await expect(page.getByTestId("device-user-code")).toHaveText("CUE-1234");
    // The denied poll returns the user to the connect screen with an actionable message.
    await expect(page.getByTestId("connect-error")).toContainText("declined");
    await expect(page.getByTestId("button-connect")).toBeVisible();
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
  });

  test("sign out revokes the token, clears the persisted store, and returns to onboarding", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await seedAuth(page.context());
    await page.goto("/profile");
    await page.evaluate(() => {
      localStorage.setItem("cue.theme", "dark");
      localStorage.setItem("cue.threshold-days", "21");
      localStorage.setItem("unrelated", "kept");
    });

    await page.getByTestId("link-settings").click();
    await expect(page.getByTestId("screen-settings")).toBeVisible();

    const revoke = page.waitForRequest("**/api.trakt.tv/oauth/revoke");
    // Sign out is guarded by a ConfirmSheet: only its primary revokes.
    await page.getByTestId("button-disconnect").click();
    await expect(page.getByText("Sign out of Cue?")).toBeVisible();
    await expect(page.getByText("Your Trakt history stays on Trakt.")).toBeVisible();
    await page.getByTestId("button-disconnect-confirm").click();
    await revoke;

    await expect(page.getByTestId("screen-onboarding")).toBeVisible();

    // The revoke carried the seeded token + the embedded client id, and no secret.
    expect(oauth.getRevokeRequests()).toHaveLength(1);
    expect(oauth.getRevokeRequests()[0]).toMatchObject({
      token: "seed-access",
      client_id: CLIENT_ID,
    });
    expect(oauth.getRevokeRequests()[0]).not.toHaveProperty("client_secret");

    // Local auth is genuinely gone from IndexedDB: not merely hidden in memory.
    expect(await readStored(page, "cue.trakt.token")).toBeNull();
    expect(
      await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("cue."))),
    ).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem("unrelated"))).toBe("kept");
  });

  test("Cancel on the sign-out confirmation keeps you connected: no revoke fires", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await seedAuth(page.context());
    await page.goto("/settings");
    await expect(page.getByTestId("screen-settings")).toBeVisible();

    await page.getByTestId("button-disconnect").click();
    await expect(page.getByTestId("button-disconnect-confirm")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // The sheet closes, the session survives, and no revoke was ever sent.
    await expect(page.getByTestId("button-disconnect-confirm")).toHaveCount(0);
    await expect(page.getByTestId("screen-settings")).toBeVisible();
    expect(oauth.getRevokeRequests()).toHaveLength(0);
    expect(await readStored(page, "cue.trakt.token")).not.toBeNull();
  });

  test("the sign-out sheet is a modal dialog: focus stays inside, and Esc/Cancel close without revoking", async ({
    page,
  }) => {
    await installHermeticRoutes(page.context());
    const oauth = await installOAuthRoutes(page.context());
    await seedAuth(page.context());
    await page.goto("/settings");
    await expect(page.getByTestId("screen-settings")).toBeVisible();

    const trigger = page.getByTestId("button-disconnect");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Sign out of Cue?" });
    await expect(dialog).toBeVisible();

    // The content is exposed as an open dialog to assistive tech.
    await expect(dialog).toHaveAttribute("data-state", "open");

    // Sheets deliberately do NOT auto-focus their first control (no pre-armed
    // destructive button); focus lands on the panel itself.
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);

    // Tabbing cycles within the dialog: focus is trapped, never escaping to the page.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    // Esc closes the sheet and releases the focus trap back to the page.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.querySelector(".sheet") === null))
      .toBe(true);

    // Reopen and dismiss via Cancel: the sheet closes the same way.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    // The session is still connected throughout: cancelling never revokes.
    await expect(page.getByTestId("screen-settings")).toBeVisible();
    expect(oauth.getRevokeRequests()).toHaveLength(0);
    expect(await readStored(page, "cue.trakt.token")).not.toBeNull();
  });
});
