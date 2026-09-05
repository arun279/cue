import { expect, type Page, test } from "@playwright/test";

/**
 * The equivalence lane's shared driving.
 *
 * These flows script user actions and nothing else: no `context.route`, no
 * fixture, no assertion about a request. What Cue asked Trakt for is recorded by
 * the fake Trakt itself, in `journal/journal-a.ndjson`, and the native app will
 * be driven through the same actions and compared against that recording. So an
 * assertion here exists only to know that the action landed before the next one
 * starts; the journal is the artifact.
 *
 * One account, one mock process, one ordered run: the files are numbered because
 * the account state each flow leaves behind is the state the next one starts
 * from, exactly as it will be on the other side of the comparison. The one
 * exception is a flow whose assertions are about what is IN the account rather
 * than about the order: it calls {@link resetAccount} first, so it reads the
 * same queue wherever it runs in the lane.
 */

/** Sign in through the redirect flow the mock answers, and land on Up Next. */
export async function connect(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("button-connect").click();
  await expect(page.getByTestId("screen-up-next")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("up-next-skeleton")).toHaveCount(0);
}

/** Every flow starts signed in; the token is per browser context, not per run. */
export function signedIn(): void {
  test.beforeEach(async ({ page }) => {
    await connect(page);
  });
}

/** Wait for the app to go quiet, so the journal's order is the flow's order and
 * not a race between a click and the read it triggers. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

/**
 * Wait for the durable queue to drain. A take-back while the write is still
 * queued coalesce-cancels the pair and sends nothing, which is correct and is
 * what the journal should record; this is for the flows that want the write to
 * have landed first, so the reversal is the separate write it becomes then.
 */
export async function landed(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string | null>((resolve, reject) => {
              const open = indexedDB.open("keyval-store");
              open.onupgradeneeded = () => open.result.createObjectStore("keyval");
              open.onsuccess = () => {
                const db = open.result;
                const request = db
                  .transaction("keyval", "readonly")
                  .objectStore("keyval")
                  .get("cue.write-queue");
                request.onsuccess = () => {
                  db.close();
                  resolve((request.result as string | undefined) ?? null);
                };
                request.onerror = () => reject(request.error);
              };
              open.onerror = () => reject(open.error);
            }),
        ),
      { timeout: 15_000 },
    )
    .toBe("[]");
}

/** The fake Trakt's origin, where its fault control plane lives. */
const MOCK_TRAKT = "http://127.0.0.1:8787";

/**
 * Arm the fake Trakt's fault modes for the next few requests. This is the one
 * place a flow configures the SERVER rather than intercepting the app: what a
 * rate limit or an outage does to Cue is a property of Trakt's answers, and the
 * native app has to survive the same ones.
 */
export async function armFault(rule: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${MOCK_TRAKT}/__fault`, {
    method: "POST",
    body: JSON.stringify(rule),
  });
  expect(response.ok).toBe(true);
}

export async function clearFaults(): Promise<void> {
  await fetch(`${MOCK_TRAKT}/__fault`, { method: "DELETE" });
}

/**
 * Put the fake Trakt's account back to the seed. For a flow that asserts on the
 * queue's contents: without it such a flow reads whatever backlog the flows
 * before it happened to leave, which is a different queue depending on where it
 * runs and how many marks the earlier flows spent. The control plane is the
 * harness talking to the mock, so it stays out of the journal.
 */
export async function resetAccount(): Promise<void> {
  const response = await fetch(`${MOCK_TRAKT}/__reset`, { method: "POST" });
  expect(response.ok).toBe(true);
}
