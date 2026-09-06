import { expect, test } from "@playwright/test";
import { connect, landed, settle } from "./_flow";

/** The write path the whole app is built around: mark the queue's lead episode,
 * take it back through the snackbar, then mark it and let it stand. */
test("marks an episode, takes it back, then marks it for good", async ({ page }) => {
  await connect(page);
  const lead = page.getByTestId("up-next-card").first();
  await expect(lead).toBeVisible();

  // Let the mark land before taking it back, so the reversal is the separate
  // per-play removal it becomes then rather than a coalesced pair that sends
  // nothing. Both are real behavior; the flow after this one records the other.
  await lead.getByTestId("mark-watched").click();
  await expect(page.getByTestId("snackbar")).toBeVisible();
  await landed(page);
  await page.getByTestId("snackbar-undo").click();
  await landed(page);

  await page.getByTestId("up-next-card").first().getByTestId("mark-watched").click();
  await expect(page.getByTestId("snackbar")).toBeVisible();
  await landed(page);
  await settle(page);
});

/** The other half of the same behavior: a take-back before the write leaves the
 * durable queue cancels the pair, so Trakt is never told anything happened. */
test("takes a mark back before it leaves the queue", async ({ page }) => {
  await connect(page);
  await page.getByTestId("up-next-card").first().getByTestId("mark-watched").click();
  await page.getByTestId("snackbar-undo").click();
  await settle(page);
});

/** Sync now: the freshness gate driven deliberately rather than by the poll. */
test("asks for a sync from Settings", async ({ page }) => {
  await connect(page);
  await page.getByTestId("avatar-link").click();
  await page.getByTestId("link-settings").click();
  await expect(page.getByTestId("screen-settings")).toBeVisible();
  await page.getByTestId("sync-now").click();
  await settle(page);
});
