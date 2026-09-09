import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { JOURNAL_FILE } from "../../playwright.config";
import { connect, landed, resetAccount, settle } from "./_flow";

interface JournalEntry {
  readonly method: string;
  readonly path: string;
}

/**
 * Everything Cue asked Trakt for, art excluded: an artwork read's count is a
 * function of scroll and layout rather than of the sync behavior budgeted here,
 * and `art-budget.spec.ts` already owns it. The sign-in leg IS counted, because
 * on this target it is two requests every cold start and a third would be a real
 * regression.
 */
const entries = (): JournalEntry[] =>
  readFileSync(JOURNAL_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalEntry)
    .filter((entry) => !entry.path.startsWith("/images/"));

/**
 * The ceiling each flow has to stay under, counted by the fake Trakt itself: the
 * app cannot influence the counter, which is what makes this evidence rather than
 * the app agreeing with itself.
 *
 * Measured on the seeded account (8 shows, 3 movies, 5 with a backlog): cold
 * start 19, one episode mark 3, manual refresh 1, foreground return 1, idle poll
 * 1. Every ceiling is that measurement plus room for one retry, NOT a round
 * multiple: the failure this exists to catch is a per-show fan-out, and a ceiling
 * far enough above the measurement to swallow one is a gate that passes the
 * defect it was built for.
 *
 * The mark is the number that moved. With `queryKeys.library()` in
 * `showProgressKeys` one mark cost 9 requests here (1 POST + 8 GET: the whole
 * library aggregate, re-read for one episode) and about 65 on a 60-show backlog;
 * scoped to the show that changed it costs 3 (1 POST, its own progress read, and
 * the history page the home screen's "Previously" section renders from). A
 * ceiling of 4 sits five below the regression and one above the truth.
 */
const CEILING = {
  coldStart: 24,
  episodeMark: 4,
  manualRefresh: 2,
  foregroundReturn: 2,
  idlePoll: 2,
} as const;

test("keeps each sync flow inside its request budget", async ({ page }) => {
  test.setTimeout(240_000);
  await resetAccount();

  /** Wait for the flow's requests to arrive AND stop, so a count is a total. */
  const settled = async (from: number, timeout: number): Promise<number> => {
    await expect.poll(() => entries().length, { timeout }).toBeGreaterThan(from);
    await settle(page);
    await page.waitForTimeout(2000);
    return entries().length - from;
  };

  let start = entries().length;
  await connect(page);
  const coldStart = await settled(start, 30_000);
  expect(coldStart).toBeLessThanOrEqual(CEILING.coldStart);

  start = entries().length;
  await page.getByTestId("up-next-card").first().getByTestId("mark-watched").click();
  await landed(page);
  const mark = await settled(start, 30_000);
  expect(mark).toBeLessThanOrEqual(CEILING.episodeMark);
  // Exactly one write, so a mark that stopped reaching Trakt fails here too.
  expect(
    entries()
      .slice(start)
      .filter((entry) => entry.method === "POST"),
  ).toHaveLength(1);

  await page.goto("/settings");
  await settle(page);
  await page.waitForTimeout(2000);
  start = entries().length;
  await page.getByTestId("sync-now").click();
  expect(await settled(start, 30_000)).toBeLessThanOrEqual(CEILING.manualRefresh);

  start = entries().length;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await settled(start, 30_000)).toBeLessThanOrEqual(CEILING.foregroundReturn);

  // Nothing touched: the 60s activities poll, and only it.
  start = entries().length;
  expect(await settled(start, 90_000)).toBeLessThanOrEqual(CEILING.idlePoll);
});
