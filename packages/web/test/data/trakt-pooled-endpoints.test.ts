import * as raw from "@data/trakt/endpoints";
import * as pooled from "@data/trakt/pooled-endpoints";
import { describe, expect, it } from "vitest";

/**
 * The dependency-cruiser rule in `.dependency-cruiser.cjs` only proves
 * `endpoints.ts` is imported from nowhere but this file (and `read-budget.ts`).
 * It says nothing about what THIS file does with what it imports: swapping one
 * `pool(raw.getShow)` for a bare re-export of `raw.getShow` still satisfies that
 * rule, still typechecks, still passes `knip`, and drops the rate gate for
 * every caller of that endpoint.
 *
 * `pool()` closes over its argument and returns a new function, so a genuinely
 * pooled export is never reference-equal to the raw one it wraps. Assert that
 * per export, naming the one that regresses, instead of trusting the import
 * graph to speak for the wrapping.
 */
describe("pooled-endpoints stays pooled", () => {
  const rawReads = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, (...args: unknown[]) => unknown] => typeof entry[1] === "function",
  );

  it.each(rawReads)("%s is wrapped, not re-exported raw", (name, rawFn) => {
    const pooledFn = (pooled as Record<string, unknown>)[name];
    if (pooledFn === undefined) return; // pooled by hand in read-budget.ts instead, e.g. getWatchedShows
    expect(pooledFn).not.toBe(rawFn);
  });

  it("covers every pooled export, not a stale subset", () => {
    expect(Object.keys(pooled).length).toBeGreaterThan(0);
    for (const name of Object.keys(pooled)) {
      expect(name in raw).toBe(true);
    }
  });
});
