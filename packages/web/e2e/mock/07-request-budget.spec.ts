import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { JOURNAL_FILE } from "../../playwright.config";
import { connect, landed, resetAccount, settle } from "./_flow";

interface JournalEntry {
  readonly method: string;
  readonly path: string;
}

const entries = (): JournalEntry[] =>
  readFileSync(JOURNAL_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry: JournalEntry) => !entry.path.startsWith("/images/"));

test("keeps each sync flow inside its request budget", async ({ page }) => {
  test.setTimeout(90_000);
  await resetAccount();

  let start = entries().length;
  await connect(page);
  await settle(page);
  expect(entries().slice(start)).toHaveLength(19);

  start = entries().length;
  await page.getByTestId("up-next-card").first().getByTestId("mark-watched").click();
  await landed(page);
  await settle(page);
  expect(entries().slice(start)).toHaveLength(2);

  await page.goto("/settings");
  await settle(page);
  start = entries().length;
  await page.getByTestId("sync-now").click();
  await settle(page);
  expect(entries().slice(start)).toHaveLength(1);

  start = entries().length;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => entries().length).toBe(start + 1);

  start = entries().length;
  await expect.poll(() => entries().length, { timeout: 65_000 }).toBe(start + 1);
});
