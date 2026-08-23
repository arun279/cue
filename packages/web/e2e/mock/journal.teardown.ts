import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { JOURNAL_FILE } from "../../playwright.config";

/**
 * Every write Cue can send, pinned as literals rather than derived from
 * `domain/write-queue/ops.ts`. Derived, a path deleted from the queue would
 * shrink the expectation and the lane would still pass, which is the migration
 * defect it exists to catch: the app quietly stops telling Trakt something while
 * every screen still behaves. These are Trakt's endpoints, so this list moves
 * only when Trakt's API does.
 */
const WRITE_PATHS = [
  "/sync/history",
  "/sync/history/remove",
  "/sync/watchlist",
  "/sync/watchlist/remove",
  "/users/hidden/progress_watched",
  "/users/hidden/progress_watched/remove",
];

/**
 * The journal is a whole-run artifact: one account, one mock process, one
 * ordered run of all five flows, which is what makes it comparable against the
 * native app's recording of the same actions. So this covers the lane, not a
 * file, and running a single spec through `--project=mock` fails it by design.
 */
test("the journal records every write path the flows drove", () => {
  const sent = new Set(
    readFileSync(JOURNAL_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string; path: string })
      .filter((entry) => entry.method === "POST")
      .map((entry) => entry.path),
  );

  expect(WRITE_PATHS.filter((path) => !sent.has(path))).toEqual([]);
});
