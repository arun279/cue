import { isBehindOwnMark, keepOwnMark } from "@cue/core/stores/own-marks";
import { expect, it } from "vitest";
import { buildRuntime } from "./_runtime";

it("forgets the account's own marks when its session ends", async () => {
  const runtime = await buildRuntime();
  keepOwnMark(7, { preCompleted: 3, season: 1, number: 4, watchedAt: "2026-07-01T00:00:00.000Z" });
  expect(isBehindOwnMark(7, 3)).toBe(true);

  await runtime.endLocalSession();

  expect(isBehindOwnMark(7, 3)).toBe(false);
});
