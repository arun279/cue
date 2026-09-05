import { expect, test } from "@playwright/test";
import { armFault, clearFaults, connect, landed, settle } from "./_flow";

/**
 * The two defects the owner reported, driven against a Trakt that misbehaves on
 * purpose. Both were the app describing its own state wrongly: a rate limit
 * reported as an outage over data that was on the screen and fine, and a row
 * that stayed green for as long as the write stayed undelivered.
 *
 * They belong in this lane rather than the hermetic one because both are
 * properties of Trakt's ANSWERS, and the native app has to survive the same
 * ones. Faults are cleared after each, so the account the earlier flows left
 * behind is the account this one leaves behind.
 */

test.afterEach(async () => {
  await clearFaults();
});

test("a 429 burst never says Trakt is unreachable, and clears itself", async ({ page }) => {
  await connect(page);
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  await settle(page);
  await expect(page.getByTestId("sync-strip")).toHaveCount(0);

  // Trakt closes the window on the library read twice, then serves it. The queue
  // on screen is real and current; the only thing in trouble is a refresh.
  await armFault({
    match: "reads",
    path: "^/sync/watched/shows",
    status: 429,
    retryAfter: 3,
    count: 2,
  });
  await page.getByTestId("up-next-card").first().getByTestId("mark-watched").click();

  const strip = page.getByTestId("sync-strip");
  await expect(strip).toHaveAttribute("data-state", "rate-limited");
  await expect(strip).toContainText("Trakt is limiting requests.");
  await expect(strip).toContainText("Retrying");
  await expect(strip).not.toContainText("unreachable");
  // Nothing for the user to do: every read is held until the window reopens.
  await expect(strip.getByRole("button", { name: "Retry" })).toHaveCount(0);
  // The queue it was showing is still there, never wiped into an error screen.
  await expect(page.getByTestId("up-next-card").first()).toBeVisible();
  await expect(page.getByTestId("up-next-error")).toHaveCount(0);

  // The window reopens, the held read goes, and the strip retracts on its own.
  await expect(strip).toHaveCount(0, { timeout: 20_000 });
});

test("a mark advances the row at once and clears its pending note when the write lands", async ({
  page,
}) => {
  await connect(page);
  const lead = page.getByTestId("up-next-card").first();
  await expect(lead).toBeVisible();
  const code = await lead.locator(".ep-row__code").textContent();

  // Trakt refuses the write outright for a stretch, so the durable queue defers
  // it. The row must advance anyway: the queue guarantees delivery.
  await armFault({ match: "writes", status: 429, retryAfter: 1, forMs: 12_000 });
  await lead.getByTestId("mark-watched").click();

  // In the frame of the tap: the episode line has already moved on.
  await expect(lead.locator(".ep-row__code")).not.toHaveText(code ?? "");
  const check = lead.getByTestId("mark-watched");
  await expect(check).toHaveAttribute("data-state", "just-marked");

  // Green is the undo window and nothing longer. Past it the row reads as
  // advanced, with a quiet note that the mark has not reached Trakt yet.
  await expect(check).toHaveAttribute("data-state", "advancing", { timeout: 15_000 });
  await expect(check).toHaveAttribute("data-pending", "true");

  // Trakt starts accepting writes again. The user asks for a sync rather than
  // waiting out the poll; the POST lands, and the note goes with it.
  await clearFaults();
  await page.getByTestId("avatar-link").click();
  await page.getByTestId("link-settings").click();
  await page.getByTestId("sync-now").click();
  await landed(page);

  await page.getByRole("link", { name: "Up Next", exact: true }).first().click();
  const settled = page.getByTestId("up-next-card").first().getByTestId("mark-watched");
  await expect(settled).toHaveAttribute("data-state", "unwatched");
  await expect(settled).not.toHaveAttribute("data-pending", "true");
  await settle(page);
});
